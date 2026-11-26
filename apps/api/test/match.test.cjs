const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} = require("@nestjs/common");
const { ProviderRateLimitedError } = require("@repo/music-resolver");
const { MatchService } = require("../dist/match/match.service.js");
const {
  MatchController,
  MATCH_LIMIT_PER_MINUTE,
} = require("../dist/match/match.controller.js");

// What NetEase heard in 3 s of "I Really Want to Stay at Your House" (the Rosa
// Walton original): an AI cover and a Cantonese version that share its audio,
// and a longer edit that puts the clip elsewhere
const HEARD = {
  noMatchReason: null,
  candidates: [
    {
      neteaseId: "3445819726",
      title: "【AI Lucy cover】I Really Want to Stay at Your House",
      artists: ["DoroP_"],
      album: null,
      durationMs: 246698,
      offsetMs: 51880,
    },
    {
      neteaseId: "2082259634",
      title: "I Really Want to Stay at Your House",
      artists: ["Gökhan Can"],
      album: "I Really Want to Stay at Your House",
      durationMs: 261758,
      offsetMs: 119560,
    },
    {
      neteaseId: "1986277975",
      title: "I Really Want to Stay At Your House",
      artists: ["三本目", "邝梓玮Sylvia"],
      album: "一首广东歌（三本目粤语填词作品集）",
      durationMs: 246480,
      offsetMs: 51860,
    },
  ],
};

function track(id, overrides = {}) {
  return {
    id,
    title: "I Really Want to Stay at Your House",
    artists: ["Someone"],
    album: null,
    durationMs: 246600,
    needsEnrichment: false,
    isrc: null,
    spotifyId: null,
    appleMusicId: null,
    deezerId: null,
    neteaseId: null,
    qqMusicId: null,
    lyrics: [{ t: 1601, x: "line" }],
    lyricsStoragePath: null,
    ...overrides,
  };
}

const ORIGINAL = track("89de8b58-f846-444d-8973-48a14052cc97", {
  artists: ["Rosa Walton", "Hallie Coggins"],
  durationMs: 246652,
  isrc: "USLS52081705",
  spotifyId: "7mykoq6R3BArsSpNDjFQTm",
  deezerId: "1144909952",
  neteaseId: "1496089152",
});
const CANTONESE = track("1c968765-fa67-4693-837f-f08383a9e0a2", {
  title: "I Really Want to Stay At Your House",
  artists: ["三本目", "邝梓玮Sylvia"],
  album: "一首广东歌（三本目粤语填词作品集）",
  durationMs: 246480,
  neteaseId: "1986277975",
  qqMusicId: "001sLpIo3UIv1p",
});
const AI_COVER = track("e3d6fde1-bc95-43ad-80a6-d5ab840980ef", {
  title: "【AI Lucy cover】I Really Want to Stay at Your House",
  durationMs: 246698,
  neteaseId: "3445819726",
  lyrics: null,
});
const LONG_EDIT = track("5d8faf98-f148-433d-b1b6-ed46c057e4b9", {
  durationMs: 261758,
  isrc: "QZTAY2363427",
  neteaseId: "2082259634",
});

// Every select() answers with the given title-search rows
function fakeDb(rows) {
  const calls = [];
  const q = {
    from: () => q,
    where: () => q,
    limit: async () => rows,
  };
  return { calls, select: () => (calls.push("select"), q) };
}

function fakeTracks({ stored = {}, synced = {}, byId = {} } = {}) {
  const calls = { sync: [], findById: [] };
  return {
    calls,
    sanitizeTrack: (t) => {
      const { lyrics, ...rest } = t;
      return { ...rest, hasLyrics: Boolean(lyrics) };
    },
    findByPlatformId: async (platform, id) => stored[`${platform}:${id}`] ?? null,
    getOrSyncTrack: async (options) => {
      calls.sync.push(`${options.platform}:${options.id}`);
      const t = synced[`${options.platform}:${options.id}`];
      if (!t) throw new NotFoundException("not found");
      return t;
    },
    findById: async (id) => {
      calls.findById.push(id);
      if (!byId[id]) throw new NotFoundException("missing");
      return byId[id];
    },
    getLyrics: async ({ trackId }) => ({
      content: [{ t: 1601, x: `lyrics of ${trackId}` }],
      contentType: "application/json",
    }),
  };
}

function sources({ heard = HEARD, deezer = null, fail } = {}) {
  const calls = { deezer: 0 };
  return {
    calls,
    matchAudio: async () => {
      if (fail) throw fail;
      return heard;
    },
    searchDeezer: async () => {
      calls.deezer++;
      return deezer;
    },
  };
}

const DTO = { fingerprint: "AAAA", duration: 3 };

test("finds the original release behind the covers NetEase heard", async () => {
  const tracksService = fakeTracks();
  const src = sources();
  const service = new MatchService(
    fakeDb([AI_COVER, CANTONESE, LONG_EDIT, ORIGINAL]),
    tracksService,
    src,
  );

  const res = await service.match(DTO, "1.2.3.4");

  assert.equal(res.track.id, ORIGINAL.id);
  assert.equal(res.track.hasLyrics, true);
  assert.equal(res.offsetMs, 51870);
  assert.deepEqual(res.lyrics, [{ t: 1601, x: `lyrics of ${ORIGINAL.id}` }]);
  // The agreeing pair first (plain upload before the AI cover), the long edit last
  assert.deepEqual(
    res.candidates.map((c) => c.neteaseId),
    ["1986277975", "3445819726", "2082259634"],
  );
  assert.deepEqual(tracksService.calls.sync, []);
  assert.equal(src.calls.deezer, 0);
});

test("picks the original when an intro matches several edits at once", async () => {
  // 2 s into the song every edit sounds the same: NetEase heard a longer
  // upload and a remix (one recording by length) and the AI cover of the original
  const intro = {
    noMatchReason: null,
    candidates: [
      { ...HEARD.candidates[1], offsetMs: 2040 },
      {
        neteaseId: "2612278517",
        title: "I Really Want to Stay At Your House (Bryan Remix)",
        artists: ["诗人月 Bryan"],
        album: null,
        durationMs: 259200,
        offsetMs: 2200,
      },
      { ...HEARD.candidates[0], offsetMs: 2200 },
    ],
  };
  const db = fakeDb([AI_COVER, CANTONESE, LONG_EDIT, ORIGINAL]);
  const service = new MatchService(db, fakeTracks(), sources({ heard: intro }));

  const res = await service.match(DTO, "1.2.3.4");

  assert.equal(res.track.id, ORIGINAL.id);
  assert.equal(res.offsetMs, 2200);
  assert.equal(res.candidates[0].neteaseId, "3445819726");
  // Both groups share a title, so the database was searched once
  assert.deepEqual(db.calls, ["select"]);
});

test("keeps the larger group when the recordings disagree on position", async () => {
  const service = new MatchService(
    fakeDb([AI_COVER, CANTONESE, LONG_EDIT, ORIGINAL]),
    fakeTracks(),
    sources(),
  );
  const res = await service.match(DTO, "1.2.3.4");
  // The long edit (one candidate, elsewhere in its song) doesn't compete
  assert.equal(res.offsetMs, 51870);
});

test("syncs Deezer's original when no indexed copy is an official release", async () => {
  const tracksService = fakeTracks({ synced: { "deezer:1144909952": ORIGINAL } });
  const src = sources({
    deezer: {
      platform: "deezer",
      url: "https://www.deezer.com/track/1144909952",
      id: "1144909952",
      isVerified: true,
      matched: { title: "I Really Want to Stay at Your House", durationMs: 246000 },
    },
  });
  const service = new MatchService(fakeDb([CANTONESE]), tracksService, src);

  const res = await service.match(DTO, "1.2.3.4");

  assert.equal(res.track.id, ORIGINAL.id);
  assert.deepEqual(tracksService.calls.sync, ["deezer:1144909952"]);
});

test("ignores a Deezer entry of a different length", async () => {
  const tracksService = fakeTracks({ synced: { "deezer:1": ORIGINAL } });
  const src = sources({
    deezer: {
      platform: "deezer",
      url: "https://www.deezer.com/track/1",
      id: "1",
      isVerified: true,
      matched: { title: "I Really Want to Stay at Your House", durationMs: 200000 },
    },
  });
  const service = new MatchService(fakeDb([CANTONESE]), tracksService, src);

  const res = await service.match(DTO, "1.2.3.4");

  assert.equal(res.track.id, CANTONESE.id);
  assert.deepEqual(tracksService.calls.sync, []);
});

test("fetches at most one track live", async () => {
  const noLyrics = track("aaaaaaaa-1111-4222-8333-444444444444", {
    title: "I Really Want to Stay At Your House",
    durationMs: 246480,
    lyrics: null,
  });
  const tracksService = fakeTracks({ synced: { "netease:1986277975": noLyrics } });
  const service = new MatchService(fakeDb([]), tracksService, sources());

  const res = await service.match(DTO, "1.2.3.4");

  assert.equal(res.track.id, noLyrics.id);
  assert.equal(res.lyrics, null);
  assert.deepEqual(tracksService.calls.sync, ["netease:1986277975"]);
});

test("answers a clip near the expected position with the followed track", async () => {
  const tracksService = fakeTracks({ byId: { [ORIGINAL.id]: ORIGINAL } });
  const db = fakeDb([]);
  const service = new MatchService(db, tracksService, sources());

  const res = await service.match(
    { ...DTO, expectedTrackId: ORIGINAL.id, expectedOffsetMs: 52_500 },
    "1.2.3.4",
  );

  assert.equal(res.track.id, ORIGINAL.id);
  assert.deepEqual(db.calls, []);
});

test("prefers the repeat near the expected position over a bigger group", async () => {
  const tracksService = fakeTracks({ byId: { [LONG_EDIT.id]: LONG_EDIT } });
  const service = new MatchService(fakeDb([]), tracksService, sources());

  const res = await service.match(
    { ...DTO, expectedTrackId: LONG_EDIT.id, expectedOffsetMs: 120_000 },
    "1.2.3.4",
  );

  assert.equal(res.track.id, LONG_EDIT.id);
  assert.equal(res.offsetMs, 119560);
});

test("404s with NetEase's reason when nothing matched", async () => {
  const service = new MatchService(
    fakeDb([]),
    fakeTracks(),
    sources({ heard: { candidates: [], noMatchReason: 10 } }),
  );

  await assert.rejects(service.match(DTO, "1.2.3.4"), (err) => {
    assert.ok(err instanceof NotFoundException);
    assert.equal(err.getResponse().noMatchReason, 10);
    return true;
  });
});

test("maps NetEase failures to 503 and 502", async () => {
  const limited = new MatchService(
    fakeDb([]),
    fakeTracks(),
    sources({ fail: new ProviderRateLimitedError("netease", 42) }),
  );
  await assert.rejects(limited.match(DTO, "1.2.3.4"), (err) => {
    assert.ok(err instanceof ServiceUnavailableException);
    assert.equal(err.getResponse().retryAfter, 42);
    return true;
  });

  const broken = new MatchService(
    fakeDb([]),
    fakeTracks(),
    sources({ fail: new Error("socket hang up") }),
  );
  await assert.rejects(broken.match(DTO, "1.2.3.4"), BadGatewayException);
});

test("has its own per-IP rate limit", () => {
  const handler = MatchController.prototype.match;
  assert.equal(MATCH_LIMIT_PER_MINUTE, 12);
  assert.equal(Reflect.getMetadata("THROTTLER:LIMITmedium", handler), 12);
  assert.equal(Reflect.getMetadata("THROTTLER:TTLmedium", handler), 60_000);
});
