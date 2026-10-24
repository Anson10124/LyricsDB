const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TracksService } = require("../dist/tracks/tracks.service.js");

const limiter = { consume: () => {}, tryConsume: () => true };
const verifiedTrack = {
  id: "791f8b9b-9593-46ce-9852-b1801d88a5d1",
  spotifyId: "4cOdK2wGLETKBW3PvgPWqT",
  isVerified: true,
};
const query = {
  platform: "spotify",
  id: "4cOdK2wGLETKBW3PvgPWqT",
  format: "json",
  forceRefresh: true,
};

function service(resolverService = {}) {
  const s = new TracksService({}, resolverService, {}, limiter, {});
  s.resolveAndStoreLyrics = async () => {
    throw new Error("lyrics must not be re-resolved for a verified track");
  };
  s.safeSaveTrack = async () => {
    throw new Error("a verified track must not be overwritten");
  };
  return s;
}

async function run(s) {
  const events = [];
  await s.runLyricsStream(query, (event) => events.push(event), "1.2.3.4");
  return events;
}

test("forceRefresh on a verified track is rejected before any upstream work", async () => {
  let resolved = false;
  const s = service({
    resolveUrl: async () => {
      resolved = true;
    },
  });
  s.findByPlatformId = async () => verifiedTrack;

  const events = await run(s);
  const last = events.at(-1);
  assert.equal(resolved, false);
  assert.equal(last.stage, "error");
  assert.match(last.data.error, /verified/);
  assert.equal(last.data.trackId, verifiedTrack.id);
});

test("forceRefresh that reaches a verified track via another link is rejected before saving", async () => {
  const s = service({
    resolveUrl: async () => ({ metadata: { title: "Example" }, links: [] }),
  });
  s.findByPlatformId = async () => null;
  s.findExistingTrackByPlatformLinks = async () => verifiedTrack;

  const events = await run(s);
  const last = events.at(-1);
  assert.equal(last.stage, "error");
  assert.match(last.data.error, /verified/);
  assert.ok(!events.some((event) => event.stage === "saving"));
});
