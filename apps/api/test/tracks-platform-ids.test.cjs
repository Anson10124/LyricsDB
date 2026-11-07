const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TracksService } = require("../dist/tracks/tracks.service.js");
const {
  collectPlatformIds,
  isSameRecording,
  mergeIntoStoredTrack,
  pickTrackMatch,
} = require("../dist/tracks/platform-ids.js");

const OLD_NETEASE = "2048982668";
const NEW_NETEASE = "2034742057";

function track(overrides = {}) {
  return {
    id: "791f8b9b-9593-46ce-9852-b1801d88a5d1",
    title: "Example",
    artists: ["Artist"],
    durationMs: 180000,
    isVerified: false,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

const metadata = {
  title: "Example",
  artist: "Artist",
  artists: ["Artist"],
  durationMs: 180000,
  isrc: "JPU902300001",
};

function service(db = {}) {
  return new TracksService(db, {}, {}, {}, {});
}

test("collectPlatformIds dedupes, trims and skips IDs too long to store", () => {
  const ids = collectPlatformIds(
    { neteaseId: ` ${NEW_NETEASE} `, spotifyId: "x".repeat(65) },
    "JPU902300001",
    { neteaseId: NEW_NETEASE, qqMusicId: "003iHc0e2UIgMC" },
  );
  assert.deepEqual(ids, [
    { platform: "netease", platformId: NEW_NETEASE },
    { platform: "isrc", platformId: "JPU902300001" },
    { platform: "qq", platformId: "003iHc0e2UIgMC" },
  ]);
});

test("pickTrackMatch prefers the source owner, then verified, then most IDs, then oldest", () => {
  const a = track({ id: "a", createdAt: new Date("2026-01-01") });
  const b = track({ id: "b", isVerified: true });
  const c = track({ id: "c", createdAt: new Date("2025-01-01") });

  assert.equal(
    pickTrackMatch([
      { track: b, matchedIds: 3, ownsSource: false },
      { track: a, matchedIds: 1, ownsSource: true },
    ]).id,
    "a",
  );
  assert.equal(
    pickTrackMatch([
      { track: a, matchedIds: 3, ownsSource: false },
      { track: b, matchedIds: 1, ownsSource: false },
    ]).id,
    "b",
  );
  assert.equal(
    pickTrackMatch([
      { track: c, matchedIds: 1, ownsSource: false },
      { track: a, matchedIds: 2, ownsSource: false },
    ]).id,
    "a",
  );
  assert.equal(
    pickTrackMatch([
      { track: a, matchedIds: 1, ownsSource: false },
      { track: c, matchedIds: 1, ownsSource: false },
    ]).id,
    "c",
  );
  assert.equal(pickTrackMatch([]), null);
});

test("an existing row keeps its IDs when another version resolves to it", () => {
  const existing = track({ neteaseId: OLD_NETEASE, isrc: "JPU902300001" });
  const entity = service().assembleTrackEntity(
    { ...metadata, isrc: "JPU902399999" },
    { neteaseId: NEW_NETEASE, spotifyId: "4cOdK2wGLETKBW3PvgPWqT" },
    {
      lyricsType: null,
      lyrics: null,
      lyricsStoragePath: null,
      lyricsProvider: null,
    },
    existing,
  );
  assert.equal(entity.neteaseId, OLD_NETEASE);
  assert.equal(entity.isrc, "JPU902300001");
  assert.equal(entity.spotifyId, "4cOdK2wGLETKBW3PvgPWqT");
});

test("a sync records the requested ID, the new version's IDs, the ISRC and the old IDs", async () => {
  const existing = track({ neteaseId: OLD_NETEASE });
  const s = new TracksService(
    {},
    {
      resolveUrl: async () => ({
        metadata,
        links: {
          netease: {
            platform: "netease",
            id: NEW_NETEASE,
            isVerified: true,
            matchReason: "direct",
          },
          qqMusic: { platform: "qqMusic", id: "003iHc0e2UIgMC", score: 0.9 },
          spotify: { platform: "spotify", id: "weak", score: 0.4 },
        },
      }),
    },
    {},
    {},
    {},
  );
  s.findExistingTrackByPlatformLinks = async (_links, meta) => {
    assert.equal(meta.isrc, metadata.isrc);
    return existing;
  };
  s.resolveAndStoreLyrics = async () => ({
    lyricsType: "word",
    lyrics: [[[1, 0, 100, "Hi "]]],
    lyricsStoragePath: null,
    lyricsProvider: "amll-db",
  });
  s.dropIdsOwnedElsewhere = async (data) => data;
  s.safeSaveTrack = async (data) => ({ ...existing, ...data });
  s.findPlatformIdOwners = async () => new Map();
  let recorded;
  s.recordPlatformIds = async (trackId, ids) => {
    recorded = { trackId, ids };
  };

  const saved = await s.executeSyncAndStore(
    "https://music.163.com/#/song?id=1",
  );
  assert.equal(saved.neteaseId, OLD_NETEASE);
  assert.equal(recorded.trackId, existing.id);
  assert.deepEqual(
    recorded.ids.map((r) => `${r.platform}:${r.platformId}`).sort(),
    [
      `isrc:${metadata.isrc}`,
      `netease:${NEW_NETEASE}`,
      `netease:${OLD_NETEASE}`,
      "qq:003iHc0e2UIgMC",
    ],
  );
});

test("primary IDs owned by a different track are dropped before saving", async () => {
  const s = service();
  s.findPlatformIdOwners = async () =>
    new Map([
      [`netease:${NEW_NETEASE}`, new Set(["other-track"])],
      ["qq:003iHc0e2UIgMC", new Set(["self"])],
    ]);
  const cleaned = await s.dropIdsOwnedElsewhere({
    id: "self",
    title: "Example",
    artists: ["Artist"],
    durationMs: 1,
    neteaseId: NEW_NETEASE,
    qqMusicId: "003iHc0e2UIgMC",
  });
  assert.equal(cleaned.neteaseId, null);
  assert.equal(cleaned.qqMusicId, "003iHc0e2UIgMC");
});

test("matching picks the track that owns the requested ID over a verified duplicate", async () => {
  const owner = track({ id: "owner" });
  const verified = track({ id: "verified", isVerified: true });
  const s = service({
    select: () => ({
      from: () => ({ where: async () => [verified, owner] }),
    }),
  });
  s.findPlatformIdOwners = async () =>
    new Map([
      [`netease:${NEW_NETEASE}`, new Set(["owner"])],
      [`isrc:${metadata.isrc}`, new Set(["verified"])],
    ]);

  const match = await s.findExistingTrackByPlatformLinks(
    {
      netease: {
        platform: "netease",
        id: NEW_NETEASE,
        isVerified: true,
        matchReason: "direct",
      },
    },
    metadata,
  );
  assert.equal(match.id, "owner");
});

test("matching returns null when no ID is known", async () => {
  const s = service();
  s.findPlatformIdOwners = async () => new Map();
  assert.equal(
    await s.findExistingTrackByPlatformLinks(
      { netease: { platform: "netease", id: NEW_NETEASE, isVerified: true } },
      metadata,
    ),
    null,
  );
});

test("a failed alias write does not fail the request", async () => {
  const s = service({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {
          throw new Error("db down");
        },
      }),
    }),
  });
  await s.recordPlatformIds("791f8b9b-9593-46ce-9852-b1801d88a5d1", [
    { platform: "netease", platformId: NEW_NETEASE },
  ]);
});

const directLink = {
  netease: {
    platform: "netease",
    id: NEW_NETEASE,
    isVerified: true,
    matchReason: "direct",
  },
};

function fuzzyLink(platform, id, matched) {
  return {
    platform,
    id,
    isVerified: true,
    score: 0.9,
    matchReason: "fuzzy",
    matched,
  };
}

function matchingService(rows, owners) {
  const s = service({
    select: () => ({ from: () => ({ where: async () => rows }) }),
  });
  s.findPlatformIdOwners = async () => owners;
  return s;
}

const noLyrics = {
  lyricsType: null,
  lyrics: null,
  lyricsStoragePath: null,
  lyricsProvider: null,
};

test("isSameRecording needs matching duration and version tags", () => {
  const studio = { title: "Example", album: "Album", durationMs: 180000 };
  assert.equal(isSameRecording(studio, { ...studio, durationMs: 184000 }), true);
  assert.equal(
    isSameRecording(studio, {
      title: "Example - 2011 Remaster",
      durationMs: 181000,
    }),
    true,
  );
  assert.equal(isSameRecording(studio, { ...studio, durationMs: 200000 }), false);
  assert.equal(
    isSameRecording(studio, { ...studio, title: "Example (Live)" }),
    false,
  );
  assert.equal(
    isSameRecording(studio, { ...studio, title: "Example - Acoustic" }),
    false,
  );
  assert.equal(
    isSameRecording(studio, { ...studio, title: "Example (DJ Remix)" }),
    false,
  );
  assert.equal(
    isSameRecording(studio, { ...studio, album: "Live at Wembley" }),
    false,
  );
  // An unknown duration (imported rows) leaves only the version check
  assert.equal(
    isSameRecording(studio, { title: "Example", durationMs: 0 }),
    true,
  );
});

test("search matches of another version are not trusted as this track's IDs", () => {
  const ids = service().extractHighConfidencePlatformIds(
    {
      ...directLink,
      qqMusic: fuzzyLink("qqMusic", "qq-live", {
        title: "Example (Live)",
        durationMs: 181000,
      }),
      deezer: fuzzyLink("deezer", "dz-edit", {
        title: "Example",
        durationMs: 150000,
      }),
      spotify: fuzzyLink("spotify", "sp-same", {
        title: "Example",
        durationMs: 181000,
      }),
      appleMusic: {
        platform: "appleMusic",
        id: "ap-isrc",
        isVerified: true,
        score: 1,
        matchReason: "isrc",
      },
    },
    metadata,
  );
  assert.equal(ids.neteaseId, NEW_NETEASE);
  assert.equal(ids.qqMusicId, undefined);
  assert.equal(ids.deezerId, undefined);
  assert.equal(ids.spotifyId, "sp-same");
  assert.equal(ids.appleMusicId, "ap-isrc");
});

test("matching does not merge a different version found through a shared ID", async () => {
  const live = track({ id: "live", title: "Example (Live)" });
  const s = matchingService(
    [live],
    new Map([[`isrc:${metadata.isrc}`, new Set(["live"])]]),
  );
  assert.equal(
    await s.findExistingTrackByPlatformLinks(directLink, metadata),
    null,
  );
});

test("matching does not merge a recording with a different length", async () => {
  const edit = track({ id: "edit", durationMs: 150000 });
  const s = matchingService(
    [edit],
    new Map([[`isrc:${metadata.isrc}`, new Set(["edit"])]]),
  );
  assert.equal(
    await s.findExistingTrackByPlatformLinks(directLink, metadata),
    null,
  );
});

test("matching merges into an imported row despite its placeholder duration", async () => {
  // AMLL imports guess the duration from the lyrics; the platform's is the real one
  const imported = track({
    id: "imported",
    durationMs: 170000,
    needsEnrichment: true,
  });
  const s = matchingService(
    [imported],
    new Map([[`isrc:${metadata.isrc}`, new Set(["imported"])]]),
  );
  const match = await s.findExistingTrackByPlatformLinks(directLink, metadata);
  assert.equal(match.id, "imported");
});

test("matching still keeps another version apart from an imported row", async () => {
  const importedLive = track({
    id: "imported-live",
    title: "Example (Live)",
    durationMs: 170000,
    needsEnrichment: true,
  });
  const s = matchingService(
    [importedLive],
    new Map([[`isrc:${metadata.isrc}`, new Set(["imported-live"])]]),
  );
  assert.equal(
    await s.findExistingTrackByPlatformLinks(directLink, metadata),
    null,
  );
});

test("matching still returns the track that owns the requested ID", async () => {
  const owner = track({
    id: "owner",
    title: "Example (Live)",
    durationMs: 240000,
  });
  const s = matchingService(
    [owner],
    new Map([[`netease:${NEW_NETEASE}`, new Set(["owner"])]]),
  );
  const match = await s.findExistingTrackByPlatformLinks(directLink, metadata);
  assert.equal(match.id, "owner");
});

test("an existing row keeps its title, album, duration and artwork", () => {
  const existing = track({
    album: "Album",
    artwork: { url: "https://example.com/album.jpg" },
    needsEnrichment: false,
  });
  const entity = service().assembleTrackEntity(
    {
      ...metadata,
      title: "Example - Single Version",
      album: "Example (Single)",
      durationMs: 181000,
      artwork: { url: "https://example.com/single.jpg" },
    },
    {},
    noLyrics,
    existing,
  );
  assert.equal(entity.title, "Example");
  assert.equal(entity.album, "Album");
  assert.equal(entity.durationMs, 180000);
  assert.equal(entity.artwork.url, "https://example.com/album.jpg");
});

test("an imported row takes the platform's metadata", () => {
  const existing = track({
    title: "example",
    album: null,
    durationMs: 0,
    needsEnrichment: true,
  });
  const entity = service().assembleTrackEntity(
    {
      ...metadata,
      album: "Album",
      artwork: { url: "https://example.com/a.jpg" },
    },
    {},
    noLyrics,
    existing,
  );
  assert.equal(entity.title, "Example");
  assert.equal(entity.album, "Album");
  assert.equal(entity.durationMs, 180000);
  assert.equal(entity.artwork.url, "https://example.com/a.jpg");
  assert.equal(entity.needsEnrichment, false);
});

test("merging a save into its twin keeps the row's details and fills only empty IDs", () => {
  const existing = track({
    id: "twin",
    album: "Album",
    neteaseId: OLD_NETEASE,
    lyricsStoragePath: "lyrics/twin.json",
    lyricsType: "word",
    lyricsProvider: "netease-yrc",
    hasTranslation: true,
  });
  const merged = mergeIntoStoredTrack(existing, {
    title: "Example - Single Version",
    artists: ["Artist"],
    album: "Example (Single)",
    durationMs: 181000,
    neteaseId: NEW_NETEASE,
    spotifyId: "spotify1",
    lyrics: [{ text: "line" }],
    lyricsType: "line",
    lyricsProvider: "lrclib",
    lyricsStoragePath: null,
    hasTranslation: false,
  });
  assert.equal(merged.id, "twin");
  assert.equal(merged.title, "Example");
  assert.equal(merged.album, "Album");
  assert.equal(merged.durationMs, 180000);
  assert.equal(merged.neteaseId, OLD_NETEASE);
  assert.equal(merged.spotifyId, "spotify1");
  // The row's lyrics stay together: not its storage path with the fresh type
  assert.equal(merged.lyricsStoragePath, "lyrics/twin.json");
  assert.equal(merged.lyrics, null);
  assert.equal(merged.lyricsType, "word");
  assert.equal(merged.lyricsProvider, "netease-yrc");
  assert.equal(merged.hasTranslation, true);
});

test("merging takes the fresh lyrics bundle when the row has none", () => {
  const merged = mergeIntoStoredTrack(track({ id: "twin" }), {
    title: "Example",
    artists: ["Artist"],
    durationMs: 180000,
    lyrics: null,
    lyricsType: "word",
    lyricsProvider: "netease-yrc",
    lyricsStoragePath: "lyrics/new.json",
    hasRomaji: true,
  });
  assert.equal(merged.lyricsStoragePath, "lyrics/new.json");
  assert.equal(merged.lyricsType, "word");
  assert.equal(merged.lyricsProvider, "netease-yrc");
  assert.equal(merged.hasRomaji, true);
});

const uniqueViolation = Object.assign(new Error("duplicate key"), {
  code: "23505",
});

// A db stub whose first insert fails on a unique index, recording every write
function conflictService({ rows = [], owners = new Map() } = {}) {
  const writes = [];
  let inserts = 0;
  const insertResult = (data) => {
    inserts++;
    if (inserts === 1) throw uniqueViolation;
    writes.push({ kind: "insert", data });
    return [{ ...data, id: data.id ?? "inserted" }];
  };
  const s = service({
    insert: () => ({
      values: (data) => ({
        returning: async () => insertResult(data),
        onConflictDoUpdate: () => ({
          returning: async () => insertResult(data),
        }),
      }),
    }),
    update: () => ({
      set: (data) => ({
        where: () => ({
          returning: async () => {
            writes.push({ kind: "update", data });
            return [{ ...data }];
          },
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: async () => rows }) }),
  });
  s.activityService = { recordTrackAdded: () => {} };
  s.findPlatformIdOwners = async () => owners;
  return { s, writes };
}

const raceSave = {
  title: "Example - Single Version",
  artists: ["Artist"],
  album: "Example (Single)",
  durationMs: 181000,
  neteaseId: NEW_NETEASE,
  ...noLyrics,
};

test("a racing insert merges into its same-recording twin without overwriting it", async () => {
  const twin = track({ id: "twin", album: "Album", neteaseId: NEW_NETEASE });
  const { s, writes } = conflictService({
    rows: [twin],
    owners: new Map([[`netease:${NEW_NETEASE}`, new Set(["twin"])]]),
  });

  const saved = await s.safeSaveTrack(raceSave);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].kind, "update");
  assert.equal(saved.id, "twin");
  assert.equal(saved.title, "Example");
  assert.equal(saved.album, "Album");
});

test("a racing insert merges into an imported twin despite its placeholder duration", async () => {
  const twin = track({
    id: "twin",
    durationMs: 170000,
    neteaseId: NEW_NETEASE,
    needsEnrichment: true,
  });
  const { s, writes } = conflictService({
    rows: [twin],
    owners: new Map([[`netease:${NEW_NETEASE}`, new Set(["twin"])]]),
  });

  const saved = await s.safeSaveTrack(raceSave);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].kind, "update");
  assert.equal(saved.id, "twin");
});

test("a racing insert never merges into a different version that holds its ID", async () => {
  const live = track({ id: "live", title: "Example (Live)", neteaseId: NEW_NETEASE });
  const { s, writes } = conflictService({
    rows: [live],
    owners: new Map([[`netease:${NEW_NETEASE}`, new Set(["live"])]]),
  });

  const saved = await s.safeSaveTrack(raceSave);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].kind, "insert");
  assert.equal(writes[0].data.neteaseId, null);
  assert.equal(saved.title, "Example - Single Version");
});

test("a save does not record IDs another track holds as its own aliases", async () => {
  const s = service();
  s.dropIdsOwnedElsewhere = async (data) => ({ ...data, neteaseId: null });
  s.safeSaveTrack = async (data) => ({ ...data, id: "mine" });
  s.findPlatformIdOwners = async () =>
    new Map([[`netease:${NEW_NETEASE}`, new Set(["live"])]]);
  let recorded;
  s.recordPlatformIds = async (_trackId, ids) => {
    recorded = ids;
  };

  await s.saveTrackWithPlatformIds(
    { ...raceSave, spotifyId: "spotify1" },
    { neteaseId: NEW_NETEASE, spotifyId: "spotify1" },
  );
  assert.deepEqual(recorded, [{ platform: "spotify", platformId: "spotify1" }]);
});

test("a conflicting update stays on its own row and drops the taken ID", async () => {
  const { s, writes } = conflictService({
    owners: new Map([[`netease:${NEW_NETEASE}`, new Set(["other"])]]),
  });

  const saved = await s.safeSaveTrack({ ...raceSave, id: "mine" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].kind, "insert");
  assert.equal(writes[0].data.id, "mine");
  assert.equal(writes[0].data.neteaseId, null);
  assert.equal(saved.id, "mine");
});

test("a Musixmatch link that is another recording is not trusted", () => {
  const ids = service().extractHighConfidencePlatformIds(
    {
      spotify: fuzzyLink("spotify", "spotify1", {
        title: "Example (Live)",
        durationMs: 180000,
      }),
    },
    metadata,
  );
  assert.equal(ids.spotifyId, undefined);
});
