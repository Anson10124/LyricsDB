const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TracksService } = require("../dist/tracks/tracks.service.js");

const HOUR = 60 * 60 * 1000;

function track(overrides = {}) {
  return {
    id: "791f8b9b-9593-46ce-9852-b1801d88a5d1",
    title: "Example",
    artists: ["Artist"],
    durationMs: 180000,
    spotifyId: "4cOdK2wGLETKBW3PvgPWqT",
    lyrics: null,
    lyricsStoragePath: null,
    updatedAt: new Date(Date.now() - 2 * HOUR),
    ...overrides,
  };
}

function serviceWith(cached, { uncachedAllowed = true, sync } = {}) {
  const touched = [];
  const db = {
    update: () => ({
      set: (values) => ({
        where: async () => touched.push(values.updatedAt),
      }),
    }),
  };
  const limiter = {
    consume: () => {},
    tryConsume: (_ip, type) => type !== "uncached" || uncachedAllowed,
  };
  const service = new TracksService(db, {}, {}, limiter, {});
  service.findByPlatformId = async () => cached;
  let syncCalls = 0;
  service.executeSyncAndStore = async (url) => {
    syncCalls++;
    return sync ? sync(url) : cached;
  };
  return { service, syncCalls: () => syncCalls, touched };
}

const query = { platform: "spotify", id: "4cOdK2wGLETKBW3PvgPWqT" };

test("cached tracks with lyrics are served without a live sync", async () => {
  const cached = track({ lyrics: [[[1, 0, 100, "Hi "]]] });
  const { service, syncCalls } = serviceWith(cached);
  assert.equal(await service.getOrSyncTrack(query, "203.0.113.7"), cached);
  assert.equal(syncCalls(), 0);
});

test("a recent lyrics miss is not retried yet", async () => {
  const cached = track({ updatedAt: new Date() });
  const { service, syncCalls } = serviceWith(cached);
  assert.equal(await service.getOrSyncTrack(query, "203.0.113.7"), cached);
  assert.equal(syncCalls(), 0);
});

test("a stale lyrics miss is re-synced live", async () => {
  const cached = track();
  const refreshed = track({ lyrics: [[[1, 0, 100, "Hi "]]], updatedAt: new Date() });
  const { service, syncCalls } = serviceWith(cached, {
    sync: (url) => {
      assert.match(url, /open\.spotify\.com\/track\/4cOdK2wGLETKBW3PvgPWqT/);
      return refreshed;
    },
  });
  assert.equal(await service.getOrSyncTrack(query, "203.0.113.7"), refreshed);
  assert.equal(syncCalls(), 1);
});

test("a stale miss is served from cache when the uncached budget is spent", async () => {
  const cached = track();
  const { service, syncCalls } = serviceWith(cached, { uncachedAllowed: false });
  assert.equal(await service.getOrSyncTrack(query, "203.0.113.7"), cached);
  assert.equal(syncCalls(), 0);
});

test("a failed retry falls back to the cached row and records the attempt", async () => {
  const cached = track();
  const { service, touched } = serviceWith(cached, {
    sync: () => {
      throw new Error("upstream down");
    },
  });
  assert.equal(await service.getOrSyncTrack(query, "203.0.113.7"), cached);
  assert.equal(touched.length, 1);
});

test("concurrent retries of the same track share one sync", async () => {
  const cached = track();
  const { service, syncCalls } = serviceWith(cached, {
    sync: () => new Promise((resolve) => setTimeout(() => resolve(cached), 10)),
  });
  await Promise.all([
    service.getOrSyncTrack(query, "203.0.113.7"),
    service.getOrSyncTrack(query, "198.51.100.2"),
  ]);
  assert.equal(syncCalls(), 1);
});
