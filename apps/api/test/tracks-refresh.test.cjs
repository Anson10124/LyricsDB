const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TracksService } = require("../dist/tracks/tracks.service.js");

const oldLyrics = [[[1, 1000, 1000, "Cached line "]]];
const newLyrics = [
  [[3, 5000, 500, "New duet "]],
  [[4, 5500, 500, "Backing vocal "]],
];
const metadata = {
  title: "Example",
  artists: ["Artist"],
  artist: "Artist",
  durationMs: 180000,
  type: "song",
};
const existing = {
  id: "791f8b9b-9593-46ce-9852-b1801d88a5d1",
  title: "Example",
  artists: ["Artist"],
  durationMs: 180000,
  spotifyId: "4cOdK2wGLETKBW3PvgPWqT",
  lyrics: oldLyrics,
  lyricsProvider: "amll-db",
  lyricsType: "word",
  hasTranslation: false,
  hasRomaji: false,
};

function serviceWith(result, storage = { isConfigured: () => false }) {
  const service = new TracksService({}, {}, storage, {}, {});
  let calls = 0;
  service.lyricsEngine = {
    resolveLyrics: async (context) => {
      calls++;
      assert.equal(context.spotifyId, existing.spotifyId);
      return result;
    },
  };
  return { service, calls: () => calls };
}

test("existing lyrics remain cached without an explicit refresh", async () => {
  const { service, calls } = serviceWith(null);
  const result = await service.resolveAndStoreLyrics(metadata, {}, existing);
  assert.equal(calls(), 0);
  assert.equal(result.lyricsProvider, "amll-db");
  assert.deepEqual(result.resolvedRawLyrics, oldLyrics);
});

test("refresh resolves again and persists Lyricify with the compact payload", async () => {
  const { service, calls } = serviceWith({
    provider: "Lyricify",
    source: "lyricify-qrc",
    lyricsType: "word",
    lyrics: newLyrics,
    hasTranslation: true,
    hasRomaji: false,
  });
  const result = await service.resolveAndStoreLyrics(
    metadata,
    {},
    existing,
    undefined,
    true,
  );
  assert.equal(calls(), 1);
  assert.equal(result.lyricsProvider, "Lyricify");
  assert.equal(result.hasTranslation, true);
  assert.deepEqual(result.resolvedRawLyrics, newLyrics);
  const entity = service.assembleTrackEntity(metadata, {}, result, existing);
  let written;
  const builder = {
    values(value) {
      written = value;
      return this;
    },
    onConflictDoUpdate() {
      return this;
    },
    async returning() {
      return [written];
    },
  };
  service.db = { insert: () => builder };
  await service.safeSaveTrack(entity);
  assert.equal(written.lyricsProvider, "Lyricify");
  assert.deepEqual(written.lyrics, newLyrics);
  assert.equal(written.hasTranslation, true);
  assert.ok(!("DuetProperties" in written));
});

test("a refresh miss keeps the previous inline lyrics and provider", async () => {
  const { service, calls } = serviceWith(null);
  const result = await service.resolveAndStoreLyrics(
    metadata,
    {},
    existing,
    undefined,
    true,
  );
  assert.equal(calls(), 1);
  assert.equal(result.lyricsProvider, "amll-db");
  assert.deepEqual(result.lyrics, oldLyrics);
  assert.deepEqual(result.resolvedRawLyrics, oldLyrics);
});

test("a refresh miss retains offloaded lyrics and refresh success replaces their storage path", async () => {
  let saved;
  const storage = {
    isConfigured: () => true,
    getLyrics: async () => oldLyrics,
    saveLyrics: async (_id, lyrics) => {
      saved = lyrics;
      return "lyrics/new.json";
    },
  };
  const offloaded = {
    ...existing,
    lyrics: null,
    lyricsStoragePath: "lyrics/old.json",
  };
  const miss = serviceWith(null, storage);
  const fallback = await miss.service.resolveAndStoreLyrics(
    metadata,
    {},
    offloaded,
    undefined,
    true,
  );
  assert.equal(fallback.lyricsStoragePath, "lyrics/old.json");
  assert.deepEqual(fallback.resolvedRawLyrics, oldLyrics);
  const found = serviceWith(
    {
      provider: "Lyricify",
      source: "lyricify-qrc",
      lyricsType: "word",
      lyrics: newLyrics,
    },
    storage,
  );
  const result = await found.service.resolveAndStoreLyrics(
    metadata,
    {},
    offloaded,
    undefined,
    true,
  );
  assert.equal(result.lyricsProvider, "Lyricify");
  assert.equal(result.lyrics, null);
  assert.equal(result.lyricsStoragePath, "lyrics/new.json");
  assert.deepEqual(saved, newLyrics);
});
