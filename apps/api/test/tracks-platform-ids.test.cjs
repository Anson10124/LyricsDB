const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TracksService } = require("../dist/tracks/tracks.service.js");
const {
  collectPlatformIds,
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
  s.findExistingTrackByPlatformLinks = async (_links, isrc) => {
    assert.equal(isrc, metadata.isrc);
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
    metadata.isrc,
  );
  assert.equal(match.id, "owner");
});

test("matching returns null when no ID is known", async () => {
  const s = service();
  s.findPlatformIdOwners = async () => new Map();
  assert.equal(
    await s.findExistingTrackByPlatformLinks({
      netease: { platform: "netease", id: NEW_NETEASE, isVerified: true },
    }),
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
