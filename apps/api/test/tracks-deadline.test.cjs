const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { GatewayTimeoutException } = require("@nestjs/common");
const { currentAbortSignal } = require("@repo/music-resolver");
const { TracksService } = require("../dist/tracks/tracks.service.js");

const limiter = { consume: () => {}, tryConsume: () => true };

// AbortSignal.timeout uses an unref'd timer; in the server the HTTP listener keeps
// the event loop alive, here this does
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

function service() {
  const s = new TracksService({}, {}, {}, limiter, {});
  s.syncTimeoutMs = 30;
  s.findByPlatformId = async () => null;
  return s;
}

const query = { platform: "spotify", id: "4cOdK2wGLETKBW3PvgPWqT" };

test("a live sync that overruns its deadline fails with 504 and is cancelled", async () => {
  const s = service();
  let syncSignal;
  s.executeSyncAndStore = () => {
    syncSignal = currentAbortSignal();
    return new Promise(() => {}); // never settles, e.g. an upstream ignoring cancellation
  };
  await assert.rejects(
    s.getOrSyncTrack(query, "203.0.113.7"),
    (err) => err instanceof GatewayTimeoutException,
  );
  assert.equal(syncSignal.aborted, true);
  // The lock is released so the next request can try again
  assert.equal(s.inFlightRequests.size, 0);
});

test("SSE streams report a timeout when the deadline runs out", async () => {
  const s = service();
  s.runLyricsStream = () => new Promise(() => {});
  const events = [];
  await s.streamLyrics(query, (e) => events.push(e), "203.0.113.7");
  assert.equal(events.length, 1);
  assert.equal(events[0].stage, "error");
  assert.match(events[0].data.error, /Timed out/);
});

test("SSE disconnect cancels the work without emitting an error", async () => {
  const s = service();
  s.syncTimeoutMs = 10_000;
  const disconnect = new AbortController();
  let workSignal;
  s.runLyricsStream = () => {
    workSignal = currentAbortSignal();
    return new Promise(() => {});
  };
  const events = [];
  const stream = s.streamLyrics(query, (e) => events.push(e), "203.0.113.7", disconnect.signal);
  disconnect.abort();
  await stream;
  assert.equal(workSignal.aborted, true);
  assert.deepEqual(events, []);
});
