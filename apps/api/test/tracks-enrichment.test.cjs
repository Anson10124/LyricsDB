const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TracksService } = require("../dist/tracks/tracks.service.js");

function enrichingService(track) {
  let syncs = 0;
  const s = new TracksService(
    {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [track] }) }),
      }),
    },
    {},
    {},
    { consume: () => {}, tryConsume: () => true },
    {},
  );
  s.syncDeduped = () => {
    syncs++;
    return Promise.reject(new Error("upstream down"));
  };
  return { s, syncs: () => syncs };
}

test("an imported track is served at once and enriched in the background, with backoff", async () => {
  const stub = {
    id: "stub",
    neteaseId: "2034742057",
    needsEnrichment: true,
    lyrics: [[[1, 0, 100, "Hi "]]],
  };
  const { s, syncs } = enrichingService(stub);
  assert.equal(await s.findById("stub"), stub);
  assert.equal(syncs(), 1);
  await new Promise((resolve) => setImmediate(resolve));
  await s.findById("stub");
  assert.equal(syncs(), 1, "a failed enrichment is not retried right away");

  const resolved = enrichingService({ ...stub, needsEnrichment: false });
  await resolved.s.findById("stub");
  assert.equal(resolved.syncs(), 0);
});

test("a live resolve clears needsEnrichment", () => {
  const entity = new TracksService({}, {}, {}, {}, {}).assembleTrackEntity(
    { title: "Idol", artist: "YOASOBI", artists: ["YOASOBI"], durationMs: 213000 },
    { neteaseId: "2034742057" },
    { lyricsType: "word", lyrics: [], lyricsStoragePath: null, lyricsProvider: "amll-db" },
    { id: "stub", neteaseId: "2034742057", needsEnrichment: true, isVerified: false },
  );
  assert.equal(entity.needsEnrichment, false);
  assert.equal(entity.durationMs, 213000);
});
