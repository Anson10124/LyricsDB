const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ConflictException, NotFoundException } = require("@nestjs/common");
const { ProviderRateLimitedError } = require("@repo/music-resolver");
const {
  CACHE_MAX_ENTRIES,
  PlatformSearchService,
  SEARCH_ADAPTERS,
} = require("../dist/tracks/platform-search.service.js");
const { TracksController } = require("../dist/tracks/tracks.controller.js");

const TRACK_ID = "791f8b9b-9593-46ce-9852-b1801d88a5d1";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";

function baseTrack(overrides = {}) {
  return {
    id: TRACK_ID,
    title: "I Could Never Love You Enough",
    artists: ["Brian McComas"],
    album: "Brian McComas",
    durationMs: 253000,
    needsEnrichment: false,
    isVerified: false,
    isrc: "USL2S0110046",
    neteaseId: null,
    ...overrides,
  };
}

// Answers each select() in turn: the track, the rejected IDs, then the owners
// by column and by alias
function fakeDb({ track, rejected = [], byColumn = [], byAlias = [] }) {
  const answers = [[track].filter(Boolean), rejected, byColumn, byAlias];
  const query = (result) => {
    const q = {
      from: () => q,
      where: () => q,
      limit: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return q;
  };
  return { select: () => query(answers.shift() ?? []) };
}

const match = (id, score = 0.9, extra = {}) => ({
  candidate: {
    id,
    url: `https://music.163.com/#/song?id=${id}`,
    title: "I Could Never Love You Enough",
    artist: "Brian McComas",
    album: "Brian McComas",
    durationMs: 253000,
    artworkUrl: "https://p1.music.126.net/a.jpg",
    ...extra,
  },
  score,
  isVerified: score >= 0.7,
  breakdown: {},
  notAvailable: false,
  matchReason: "fuzzy",
});

function resolverReturning(results) {
  const calls = [];
  return {
    calls,
    searchPlatform: async (...args) => {
      calls.push(args);
      return typeof results === "function" ? results() : results;
    },
  };
}

test("returns ranked results shaped for the editor", async () => {
  const resolver = resolverReturning([match("5257138", 0.97), match("999", 0.4)]);
  const service = new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver);

  const res = await service.search(TRACK_ID, "netease");

  assert.equal(res.platform, "netease");
  assert.deepEqual(res.results.map((r) => r.id), ["5257138", "999"]);
  assert.deepEqual(res.results[0].artists, ["Brian McComas"]);
  assert.equal(res.results[0].confident, true);
  assert.equal(res.results[1].confident, false);
  assert.equal(res.results[0].takenByTrackId, undefined);
});

test("searches the right adapter, behind resolves, with the track's own details", async () => {
  const resolver = resolverReturning([]);
  const service = new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver);
  await service.search(TRACK_ID, "apple");

  const [[adapter, target, options]] = resolver.calls;
  assert.equal(adapter, "appleMusic");
  assert.equal(target.title, "I Could Never Love You Enough");
  assert.equal(target.artist, "Brian McComas");
  assert.equal(target.isrc, "USL2S0110046");
  assert.equal(target.durationMs, 253000);
  assert.ok(options.priority < 0);
});

test("maps every searchable platform to an adapter", () => {
  assert.deepEqual(SEARCH_ADAPTERS, {
    spotify: "spotify",
    apple: "appleMusic",
    deezer: "deezer",
    netease: "netease",
    qq: "qqMusic",
  });
});

test("leaves out an imported row's placeholder duration", async () => {
  const resolver = resolverReturning([]);
  const track = baseTrack({ needsEnrichment: true, durationMs: 1 });
  await new PlatformSearchService(fakeDb({ track }), resolver).search(TRACK_ID, "netease");
  assert.equal(resolver.calls[0][1].durationMs, undefined);
});

test("drops IDs already rejected for this track", async () => {
  const resolver = resolverReturning([match("111"), match("222")]);
  const db = fakeDb({ track: baseTrack(), rejected: [{ platformId: "111" }] });
  const res = await new PlatformSearchService(db, resolver).search(TRACK_ID, "netease");
  assert.deepEqual(res.results.map((r) => r.id), ["222"]);
});

test("drops unrelated songs the platform padded its results with", async () => {
  const resolver = resolverReturning([match("111", 0.9), match("222", 0.1), match("333", 0)]);
  const res = await new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver).search(
    TRACK_ID,
    "netease",
  );
  assert.deepEqual(res.results.map((r) => r.id), ["111"]);
});

test("drops IDs the edit endpoint would refuse", async () => {
  const resolver = resolverReturning([match("not-a-number"), match("222")]);
  const res = await new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver).search(
    TRACK_ID,
    "netease",
  );
  assert.deepEqual(res.results.map((r) => r.id), ["222"]);
});

test("flags IDs that another track already owns", async () => {
  const resolver = resolverReturning([match("111"), match("222"), match("333")]);
  const db = fakeDb({
    track: baseTrack(),
    byColumn: [{ platformId: "111", trackId: OTHER_ID }],
    byAlias: [{ platformId: "333", trackId: OTHER_ID }],
  });
  const res = await new PlatformSearchService(db, resolver).search(TRACK_ID, "netease");
  assert.deepEqual(
    res.results.map((r) => r.takenByTrackId),
    [OTHER_ID, undefined, OTHER_ID],
  );
});

test("404 for an unknown track, 409 for a verified one, without searching", async () => {
  const resolver = resolverReturning([]);
  await assert.rejects(
    new PlatformSearchService(fakeDb({ track: null }), resolver).search(TRACK_ID, "netease"),
    NotFoundException,
  );
  await assert.rejects(
    new PlatformSearchService(fakeDb({ track: baseTrack({ isVerified: true }) }), resolver).search(
      TRACK_ID,
      "netease",
    ),
    ConflictException,
  );
  assert.equal(resolver.calls.length, 0);
});

test("a second search for the same track and platform is served from the cache", async () => {
  const resolver = resolverReturning([match("222")]);
  const service = new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver);
  await service.search(TRACK_ID, "netease");
  // Fresh db answers for the second request; the resolver must not be asked again
  service.db = fakeDb({ track: baseTrack() });
  const res = await service.search(TRACK_ID, "netease");
  assert.equal(resolver.calls.length, 1);
  assert.deepEqual(res.results.map((r) => r.id), ["222"]);
});

test("a changed ISRC searches again instead of reusing results scored against the old one", async () => {
  const resolver = resolverReturning([match("222")]);
  const service = new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver);
  await service.search(TRACK_ID, "netease");
  service.db = fakeDb({ track: baseTrack({ isrc: "USRC17607839" }) });
  await service.search(TRACK_ID, "netease");
  assert.equal(resolver.calls.length, 2);
  assert.equal(resolver.calls[1][1].isrc, "USRC17607839");
});

test("requests that arrive while a search runs share it", async () => {
  let finish;
  const resolver = resolverReturning(() => new Promise((r) => (finish = () => r([match("222")]))));
  const service = new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver);
  const first = service.search(TRACK_ID, "netease");
  // Let the first request reach the resolver
  await new Promise((r) => setImmediate(r));
  service.db = fakeDb({ track: baseTrack() });
  const second = service.search(TRACK_ID, "netease");
  await new Promise((r) => setImmediate(r));
  finish();
  await Promise.all([first, second]);
  assert.equal(resolver.calls.length, 1);
});

test("a failed search is not cached and becomes a 503 while the platform cools down", async () => {
  let fail = true;
  const resolver = resolverReturning(() => {
    if (fail) throw new ProviderRateLimitedError("netease", 42);
    return [match("222")];
  });
  const service = new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver);

  await assert.rejects(service.search(TRACK_ID, "netease"), (err) => {
    assert.equal(err.getStatus(), 503);
    assert.match(err.message, /42s/);
    return true;
  });

  fail = false;
  service.db = fakeDb({ track: baseTrack() });
  const res = await service.search(TRACK_ID, "netease");
  assert.equal(resolver.calls.length, 2);
  assert.deepEqual(res.results.map((r) => r.id), ["222"]);
});

test("any other upstream failure becomes a 502", async () => {
  const resolver = resolverReturning(() => {
    throw new Error("NetEase search failed with code 405");
  });
  const service = new PlatformSearchService(fakeDb({ track: baseTrack() }), resolver);
  service.logger = { warn: () => {} };
  await assert.rejects(service.search(TRACK_ID, "netease"), (err) => err.getStatus() === 502);
});

test("the cache stays bounded", async () => {
  const resolver = resolverReturning([]);
  const service = new PlatformSearchService(null, resolver);
  for (let i = 0; i < CACHE_MAX_ENTRIES + 20; i++) {
    service.db = fakeDb({ track: baseTrack({ id: `track-${i}` }) });
    await service.search(`track-${i}`, "netease");
  }
  assert.ok(service.cache.size <= CACHE_MAX_ENTRIES);
});

test("the route has its own limit of 10 searches a minute per IP", () => {
  const handler = TracksController.prototype.searchPlatform;
  assert.equal(Reflect.getMetadata("THROTTLER:LIMITmedium", handler), 10);
  assert.equal(Reflect.getMetadata("THROTTLER:TTLmedium", handler), 60_000);
});
