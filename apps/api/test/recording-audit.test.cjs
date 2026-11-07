const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  DeezerParser,
  NeteaseParser,
  QQMusicParser,
  SpotifyParser,
  AppleMusicParser,
} = require("@repo/music-resolver");
const {
  canonicalPlatformUrl,
  judgeTrackIds,
  lyricsCameFromDetachedId,
  planColumnChanges,
} = require("../dist/tracks/recording-audit.js");

function id(platform, platformId, title, durationMs, album) {
  return { platform, platformId, info: { title, durationMs, album } };
}

const studio = { title: "Song", album: "Album", durationMs: 200000 };

test("canonical links open the same ID in each platform's parser", () => {
  const cases = [
    [new SpotifyParser(), "spotify", "1svLZ9Jpcqpl48Zb94d4z0"],
    [new AppleMusicParser({}), "apple", "1715269315"],
    [new DeezerParser(), "deezer", "3888765"],
    [new NeteaseParser(), "netease", "2104657213"],
    [new QQMusicParser(), "qq", "002SXkfV4Ecoeg"],
    [new QQMusicParser(), "qq", "101834590"],
  ];
  for (const [parser, platform, platformId] of cases) {
    const url = canonicalPlatformUrl(platform, platformId);
    assert.equal(parser.match(url), true, url);
    assert.equal(parser.parse(url).id, platformId, url);
  }
  assert.equal(canonicalPlatformUrl("isrc", "USUM71900001"), null);
});

test("IDs that all match the row are left alone", () => {
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song", 200500),
    id("netease", "b", "Song", 199000),
    id("qq", "c", "Song", 201000),
  ]);
  assert.equal(verdict.kind, "ok");
});

test("a live version among studio IDs is detached", () => {
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song", 200500),
    id("netease", "b", "Song", 199000),
    id("netease", "live", "Song (Live)", 230000),
  ]);
  assert.equal(verdict.kind, "detach");
  assert.deepEqual(
    verdict.detach.map((d) => d.platformId),
    ["live"],
  );
  assert.deepEqual(
    verdict.keep.map((k) => k.platformId).sort(),
    ["a", "b"],
  );
});

test("an extended mix is told apart by its duration alone", () => {
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song", 200000),
    id("apple", "b", "Song", 201000),
    id("qq", "long", "Song", 320000),
  ]);
  assert.equal(verdict.kind, "detach");
  assert.deepEqual(verdict.detach.map((d) => d.platformId), ["long"]);
});

test("album names alone don't split a recording", () => {
  // A compilation whose name reads like a live album
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song", 200000, "Song - Single"),
    id("apple", "b", "Song", 200500, "Song - Single"),
    id("netease", "c", "Song", 200100, "Live In The Moment"),
  ]);
  assert.equal(verdict.kind, "ok");
});

test("an ID that only lacks the row's version label is kept for review", () => {
  const remix = { title: "Wolves (MOTi Remix)", durationMs: 245000 };
  const verdict = judgeTrackIds(remix, [
    id("spotify", "a", "Wolves (MOTi Remix)", 245000),
    id("apple", "b", "Wolves (MOTi Remix)", 245500),
    id("isrc", "unlabelled", "Wolves MOTi Remix", 245000),
    id("netease", "extended", "Wolves (MOTi Remix) [Extended]", 300000),
  ]);
  assert.equal(verdict.kind, "detach");
  assert.deepEqual(verdict.detach.map((d) => d.platformId), ["extended"]);
  assert.deepEqual(verdict.doubtful.map((d) => d.platformId), ["unlabelled"]);
  assert.ok(verdict.keep.some((k) => k.platformId === "unlabelled"));

  const onlyDoubtful = judgeTrackIds(remix, [
    id("spotify", "a", "Wolves (MOTi Remix)", 245000),
    id("apple", "b", "Wolves (MOTi Remix)", 245500),
    id("isrc", "unlabelled", "Wolves MOTi Remix", 245000),
  ]);
  assert.equal(onlyDoubtful.kind, "conflict");
  assert.match(onlyDoubtful.reason, /version label/);
});

test("same-length instrumentals stay linked for karaoke-style lyrics", () => {
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song", 200000),
    id("apple", "b", "Song", 200500),
    id("qq", "c", "Song", 199500),
    id("netease", "inst", "Song (伴奏)", 200000),
    id("qq", "karaoke", "Song (Karaoke Version)", 201000),
    id("netease", "live", "Song (Live)", 260000),
  ]);
  assert.equal(verdict.kind, "detach");
  assert.deepEqual(verdict.detach.map((d) => d.platformId), ["live"]);
  assert.deepEqual(
    verdict.doubtful.map((d) => d.platformId).sort(),
    ["inst", "karaoke"],
  );
});

test("a row whose own label isn't recognised keeps its matching IDs", () => {
  // "Error instrumental" has no brackets, so it reads as untagged
  const verdict = judgeTrackIds(
    { title: "Error instrumental", durationMs: 1000, needsEnrichment: true },
    [
      id("spotify", "a", "Error", 300000),
      id("apple", "b", "Error", 300500),
      id("qq", "c", "Error", 299500),
      id("qq", "inst", "Error (Inst.)", 301000),
      id("apple", "inst2", "Error (Instrumental)", 299000),
    ],
  );
  assert.equal(verdict.kind, "conflict");
});

test("IDs that couldn't be looked up are kept, never detached", () => {
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song", 200000),
    id("apple", "b", "Song", 201000),
    id("qq", "long", "Song", 320000),
    { platform: "netease", platformId: "gone", info: null },
    id("deezer", "noduration", "Song (Live)", null),
  ]);
  assert.equal(verdict.kind, "detach");
  assert.deepEqual(verdict.detach.map((d) => d.platformId), ["long"]);
  assert.ok(verdict.keep.some((k) => k.platformId === "gone"));
  assert.ok(verdict.keep.some((k) => k.platformId === "noduration"));
});

test("a tie between two recordings is only reported", () => {
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song", 200000),
    id("netease", "live", "Song (Live)", 230000),
  ]);
  assert.equal(verdict.kind, "conflict");
  assert.match(verdict.reason, /majority/);
});

test("a row that matches only a minority of its IDs is only reported", () => {
  // An older merge may have left the live version's details on the row
  const verdict = judgeTrackIds(
    { title: "Song (Live)", durationMs: 230000 },
    [
      id("spotify", "a", "Song", 200000),
      id("apple", "b", "Song", 200500),
      id("netease", "live", "Song (Live)", 230000),
    ],
  );
  assert.equal(verdict.kind, "conflict");
  assert.match(verdict.reason, /minority/);
});

test("a row that disagrees with every ID is only reported", () => {
  const verdict = judgeTrackIds(studio, [
    id("spotify", "a", "Song (Acoustic)", 180000),
    id("apple", "b", "Song (Acoustic)", 180500),
  ]);
  assert.equal(verdict.kind, "conflict");
});

test("an imported row's placeholder duration is ignored", () => {
  const verdict = judgeTrackIds(
    { title: "Song", durationMs: 1000, needsEnrichment: true },
    [
      id("spotify", "a", "Song", 200000),
      id("apple", "b", "Song", 200500),
      id("netease", "live", "Song (Live)", 230000),
    ],
  );
  assert.equal(verdict.kind, "detach");
  assert.deepEqual(verdict.detach.map((d) => d.platformId), ["live"]);
});

test("a detached primary ID is replaced by a kept ID from the same platform", () => {
  const live = id("netease", "live", "Song (Live)", 230000);
  const keep = [
    id("netease", "studio", "Song", 200000),
    { platform: "netease", platformId: "gone", info: null },
  ];
  const changes = planColumnChanges(
    { neteaseId: "live", spotifyId: "a" },
    [live, id("qq", "notprimary", "Song (Live)", 230000)],
    keep,
  );
  assert.deepEqual(changes, [
    { field: "neteaseId", from: "live", to: "studio" },
  ]);

  assert.deepEqual(planColumnChanges({ neteaseId: "live" }, [live], []), [
    { field: "neteaseId", from: "live", to: null },
  ]);
});

test("lyrics are cleared only when they were fetched by a detached ID", () => {
  const neteaseChange = [{ field: "neteaseId", from: "live", to: null }];
  assert.equal(lyricsCameFromDetachedId("netease", neteaseChange), true);
  assert.equal(lyricsCameFromDetachedId("qqmusic", neteaseChange), false);
  assert.equal(lyricsCameFromDetachedId("lrclib", neteaseChange), false);
  assert.equal(lyricsCameFromDetachedId(null, neteaseChange), false);
  assert.equal(
    lyricsCameFromDetachedId("Lyricify", [
      { field: "spotifyId", from: "x", to: null },
    ]),
    true,
  );
});
