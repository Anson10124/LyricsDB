const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  trackPlatformIds,
  trackRejectedPlatformIds,
  trackRevisions,
  tracks,
} = require("@repo/database");
const { TrackEditService } = require("../dist/tracks/track-edit.service.js");
const { TracksController } = require("../dist/tracks/tracks.controller.js");
const { TracksService } = require("../dist/tracks/tracks.service.js");

const TRACK_ID = "791f8b9b-9593-46ce-9852-b1801d88a5d1";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const UPDATED_AT = new Date("2026-11-25T10:00:00.000Z");
const lyrics = [
  [[1, 1000, 500, "Hello "], [1, 1500, 500, "world "], "Bonjour"],
  [[1, 3000, 1000, "Second line "]],
];

function baseTrack(overrides = {}) {
  return {
    id: TRACK_ID,
    title: "Example",
    durationMs: 180000,
    needsEnrichment: false,
    isVerified: true,
    lyrics,
    lyricsStoragePath: null,
    lyricsType: "word",
    lyricsProvider: "netease-yrc",
    hasTranslation: true,
    hasRomaji: false,
    isrc: "USRC17607839",
    spotifyId: "4cOdK2wGLETKBW3PvgPWqT",
    appleMusicId: null,
    deezerId: null,
    neteaseId: null,
    qqMusicId: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

// Records every write in order. `selects` answers each select() in turn.
function fakeDb({ track, selects = [] }) {
  const log = [];
  const answers = [[track].filter(Boolean), ...selects];
  const query = (result) => {
    const q = {
      from: () => q,
      where: () => q,
      limit: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return q;
  };
  const db = {
    log,
    select: () => query(answers.shift() ?? []),
    insert: (table) => ({
      values: (values) => {
        log.push({ op: "insert", table, values });
        return {
          returning: async () => [{ id: "rev-1", ...values }],
          onConflictDoNothing: async () => {},
        };
      },
    }),
    update: (table) => ({
      set: (values) => ({
        where: () => ({
          returning: async () => {
            log.push({ op: "update", table, values });
            return [{ ...track, ...values }];
          },
        }),
      }),
    }),
    delete: (table) => ({
      where: async () => log.push({ op: "delete", table }),
    }),
    transaction: async (fn) => fn(db),
  };
  return db;
}

const storage = { isConfigured: () => false, getLyrics: async () => null };
const limiter = { consume: () => {}, tryConsume: () => true };

function editService(db) {
  return new TrackEditService(db, storage, limiter);
}

test("a lyrics edit saves a revision first, then the lyrics, and clears verified", async () => {
  const db = fakeDb({ track: baseTrack() });
  const edited = [
    [[1, 1200, 500, "Hello "], [1, 1700, 500, "there "], "", "romaji"],
  ];

  const saved = await editService(db).editTrack(TRACK_ID, {
    baseUpdatedAt: UPDATED_AT.toISOString(),
    lyrics: edited,
  });

  const [revision, update] = db.log;
  assert.equal(revision.op, "insert");
  assert.equal(revision.table, trackRevisions);
  assert.deepEqual(revision.values.previous.lyrics, lyrics);
  assert.equal(revision.values.previous.isVerified, true);
  assert.deepEqual(revision.values.changed, ["lyrics"]);
  assert.match(revision.values.editorHash, /^[0-9a-f]{64}$/);

  assert.equal(update.op, "update");
  assert.equal(update.table, tracks);
  assert.deepEqual(update.values.lyrics, edited);
  assert.equal(update.values.lyricsProvider, "community");
  assert.equal(update.values.isVerified, false);
  assert.equal(update.values.hasTranslation, false);
  assert.equal(update.values.hasRomaji, true);
  assert.equal(saved.isVerified, false);
});

test("with object storage, the old lyrics are snapshotted and the edit gets its own object", async () => {
  const track = baseTrack({ lyrics: null, lyricsStoragePath: "lyrics/old.json" });
  const db = fakeDb({ track });
  const saves = [];
  const s3 = {
    isConfigured: () => true,
    getLyrics: async (path) => (path === "lyrics/old.json" ? lyrics : null),
    saveLyrics: async (key, payload) => {
      saves.push({ key, payload });
      return `lyrics/${key}.json`;
    },
  };
  const edited = [[[1, 1000, 500, "Edited "]]];

  await new TrackEditService(db, s3, limiter).editTrack(TRACK_ID, { lyrics: edited });

  const [revision, update] = db.log;
  assert.deepEqual(revision.values.previous.lyrics, lyrics);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].key, `${TRACK_ID}_edit_rev-1`);
  assert.deepEqual(saves[0].payload, edited);
  assert.equal(update.values.lyrics, null);
  assert.equal(update.values.lyricsStoragePath, `lyrics/${TRACK_ID}_edit_rev-1.json`);
});

test("invalid lyrics edits are refused before anything is written", async () => {
  const cases = [
    [baseTrack(), [], /empty/],
    [baseTrack(), [[[9, 0, 100, "x"]]], /invalid word/],
    // Ends long after the 3 minute song
    [baseTrack(), [[[1, 400000, 1000, "late "]]], /past the end/],
    [baseTrack({ lyrics: "plain text lyrics" }), lyrics, /Only synced/],
  ];
  for (const [track, edited, message] of cases) {
    const db = fakeDb({ track });
    await assert.rejects(
      editService(db).editTrack(TRACK_ID, { lyrics: edited }),
      (err) => err.getStatus() === 400 && message.test(err.message),
    );
    assert.equal(db.log.length, 0);
  }
});

test("an edit based on an older version is refused", async () => {
  const db = fakeDb({ track: baseTrack() });
  await assert.rejects(
    editService(db).editTrack(TRACK_ID, {
      baseUpdatedAt: "2026-11-01T00:00:00.000Z",
      lyrics: [[[1, 0, 100, "x "]]],
    }),
    (err) => err.getStatus() === 409,
  );
  assert.equal(db.log.length, 0);
});

test("saving with nothing changed is refused", async () => {
  const db = fakeDb({ track: baseTrack() });
  await assert.rejects(
    editService(db).editTrack(TRACK_ID, {
      lyrics,
      ids: { spotifyId: "4cOdK2wGLETKBW3PvgPWqT" },
    }),
    (err) => err.getStatus() === 400 && /Nothing/.test(err.message),
  );
});

test("fixing an ID swaps the alias and remembers the wrong one", async () => {
  // Selects after the track: column owner check, alias owner check
  const db = fakeDb({ track: baseTrack(), selects: [[], []] });

  await editService(db).editTrack(TRACK_ID, {
    ids: { spotifyId: "7GhIk7Il098yCjg4BQjzvb", isrc: "" },
  });

  const update = db.log.find((entry) => entry.op === "update");
  assert.equal(update.values.spotifyId, "7GhIk7Il098yCjg4BQjzvb");
  assert.equal(update.values.isrc, null);
  // An ID-only edit doesn't touch the lyrics, so a refresh can still fetch them
  assert.equal(update.values.lyricsProvider, undefined);

  const rejected = db.log
    .filter((e) => e.op === "insert" && e.table === trackRejectedPlatformIds)
    .map((e) => `${e.values.platform}:${e.values.platformId}`);
  assert.deepEqual(rejected.sort(), [
    "isrc:USRC17607839",
    "spotify:4cOdK2wGLETKBW3PvgPWqT",
  ]);
  const added = db.log.filter(
    (e) => e.op === "insert" && e.table === trackPlatformIds,
  );
  assert.deepEqual(added.map((e) => e.values.platformId), [
    "7GhIk7Il098yCjg4BQjzvb",
  ]);
  assert.ok(db.log.some((e) => e.op === "delete" && e.table === trackPlatformIds));
});

test("an ID that belongs to another track is refused with that track's ID", async () => {
  const db = fakeDb({ track: baseTrack(), selects: [[{ id: OTHER_ID }]] });
  await assert.rejects(
    editService(db).editTrack(TRACK_ID, {
      ids: { spotifyId: "7GhIk7Il098yCjg4BQjzvb" },
    }),
    (err) =>
      err.getStatus() === 409 && err.getResponse().trackId === OTHER_ID,
  );
  assert.equal(db.log.length, 0);
});

test("malformed IDs are refused", async () => {
  for (const ids of [
    { spotifyId: "https://open.spotify.com/track/abc" },
    { deezerId: "12ab" },
    { isrc: "not-an-isrc" },
  ]) {
    const db = fakeDb({ track: baseTrack() });
    await assert.rejects(
      editService(db).editTrack(TRACK_ID, { ids }),
      (err) => err.getStatus() === 400,
    );
  }
});

test("the edit endpoint checks Turnstile before saving", async () => {
  let saved = false;
  const controller = new TracksController(
    {},
    {
      verify: async (token, action) => {
        assert.equal(action, "edit-track");
        const err = new Error("Human verification failed.");
        throw err;
      },
    },
    {
      editTrack: async () => {
        saved = true;
      },
    },
  );
  await assert.rejects(
    controller.edit(TRACK_ID, { lyrics }, "1.2.3.4"),
    /Human verification failed/,
  );
  assert.equal(saved, false);
});

// ---------- Refresh after an edit ----------

const refreshQuery = {
  platform: "spotify",
  id: "4cOdK2wGLETKBW3PvgPWqT",
  format: "json",
  forceRefresh: true,
};

async function runStream(s, query = refreshQuery) {
  const events = [];
  await s.runLyricsStream(query, (event) => events.push(event), "1.2.3.4");
  return events;
}

test("a refresh can't replace community-edited lyrics", async () => {
  let resolved = false;
  const s = new TracksService({}, { resolveUrl: async () => (resolved = true) }, {}, limiter, {});
  s.findByPlatformId = async () =>
    baseTrack({ isVerified: false, lyricsProvider: "community" });

  const last = (await runStream(s)).at(-1);
  assert.equal(resolved, false);
  assert.equal(last.stage, "error");
  assert.match(last.data.error, /edited by the community/);
});

test("a refresh after an ID fix doesn't bring the wrong ID back", async () => {
  const fixed = baseTrack({
    isVerified: false,
    spotifyId: "7GhIk7Il098yCjg4BQjzvb",
    isrc: null,
  });
  const s = new TracksService(
    {},
    {
      // The resolver still believes the old, wrong match
      resolveUrl: async () => ({
        metadata: {
          title: "Example",
          artist: "Someone",
          durationMs: 180000,
          isrc: "USRC17607839",
        },
        links: {
          spotify: {
            platform: "spotify",
            id: "4cOdK2wGLETKBW3PvgPWqT",
            isVerified: true,
          },
        },
      }),
    },
    {},
    limiter,
    {},
  );
  s.findByPlatformId = async () => fixed;
  s.findExistingTrackByPlatformLinks = async () => fixed;
  s.loadRejectedIds = async () =>
    new Map([
      [
        TRACK_ID,
        new Set(["spotify:4cOdK2wGLETKBW3PvgPWqT", "isrc:USRC17607839"]),
      ],
    ]);
  let lyricsLookup;
  s.resolveAndStoreLyrics = async (meta, validIds) => {
    lyricsLookup = { isrc: meta.isrc, spotifyId: validIds.spotifyId };
    return { lyricsType: "word", lyrics, resolvedRawLyrics: lyrics };
  };
  let savedWith;
  s.saveTrackWithPlatformIds = async (data, validIds, isrc) => {
    savedWith = { data, validIds, isrc };
    return fixed;
  };
  s.lyricsEngine = { formatLyrics: () => ({ content: lyrics }) };

  const events = await runStream(s, { ...refreshQuery, id: "7GhIk7Il098yCjg4BQjzvb" });
  assert.equal(events.at(-1).stage, "done");
  assert.deepEqual(lyricsLookup, {
    isrc: undefined,
    spotifyId: "7GhIk7Il098yCjg4BQjzvb",
  });
  assert.equal(savedWith.validIds.spotifyId, "7GhIk7Il098yCjg4BQjzvb");
  assert.equal(savedWith.isrc, undefined);
  assert.equal(savedWith.data.spotifyId, "7GhIk7Il098yCjg4BQjzvb");
  assert.ok(!savedWith.data.isrc);
});
