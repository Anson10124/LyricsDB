const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  StatsService,
  fillDailyRows,
  foldProviderRows,
} = require("../dist/stats/stats.service.js");

const totals = {
  tracks: 10,
  withLyrics: 7,
  word: 4,
  line: 2,
  plain: 1,
  translation: 3,
  romaji: 1,
  verified: 0,
  spotify: 9,
  appleMusic: 5,
  deezer: 6,
  netease: 2,
  qqMusic: 1,
};

function serviceWith(overrides = {}) {
  const s = new StatsService({});
  let calls = 0;
  s.queryTotals = async () => {
    calls++;
    return overrides.totals ?? totals;
  };
  s.queryProviderRows = async () => overrides.providerRows ?? [];
  s.queryDailyRows = async () => overrides.dailyRows ?? [];
  return { s, calls: () => calls };
}

test("provider rows fold into per-provider sync breakdowns sorted by total", () => {
  const result = foldProviderRows([
    { provider: "lrclib", lyricsType: "line", value: 2 },
    { provider: "amll-db", lyricsType: "word", value: 3 },
    { provider: "lrclib", lyricsType: "plain", value: 1 },
    { provider: "amll-db", lyricsType: "line", value: 1 },
    { provider: null, lyricsType: "word", value: 1 },
  ]);
  assert.deepEqual(result, [
    { provider: "amll-db", total: 4, word: 3, line: 1, plain: 0 },
    { provider: "lrclib", total: 3, word: 0, line: 2, plain: 1 },
    { provider: "unknown", total: 1, word: 1, line: 0, plain: 0 },
  ]);
});

test("the daily series covers 30 UTC days and fills missing days with zero", () => {
  const now = Date.UTC(2026, 9, 24, 15, 30);
  const result = fillDailyRows(
    [
      { date: "2026-10-24", value: 5 },
      { date: "2026-09-25", value: 2 },
    ],
    now,
  );
  assert.equal(result.length, 30);
  assert.deepEqual(result[0], { date: "2026-09-25", count: 2 });
  assert.deepEqual(result[29], { date: "2026-10-24", count: 5 });
  assert.equal(
    result.slice(1, 29).every((d) => d.count === 0),
    true,
  );
});

test("stats derive tracks without lyrics and list every platform", async () => {
  const { s } = serviceWith();
  const stats = await s.getStats();
  assert.equal(stats.totals.none, 3);
  assert.deepEqual(
    stats.platforms.map((p) => [p.platform, p.count]),
    [
      ["spotify", 9],
      ["appleMusic", 5],
      ["deezer", 6],
      ["netease", 2],
      ["qqMusic", 1],
    ],
  );
});

test("results are cached within the TTL and concurrent misses share one query", async () => {
  const { s, calls } = serviceWith();
  const [a, b] = await Promise.all([s.getStats(), s.getStats()]);
  assert.equal(calls(), 1);
  assert.equal(a, b);
  assert.equal(await s.getStats(), a);
  assert.equal(calls(), 1);

  s.cached.expiresAt = Date.now() - 1;
  await s.getStats();
  assert.equal(calls(), 2);
});

test("a failed computation is not cached", async () => {
  const { s } = serviceWith();
  s.queryTotals = async () => {
    throw new Error("db down");
  };
  await assert.rejects(s.getStats(), /db down/);
  assert.equal(s.cached, null);
  assert.equal(s.inFlight, null);
});
