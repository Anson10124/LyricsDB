import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseLys, stringifyLqe } from "@applemusic-like-lyrics/lyric";
import { TTMLParser, toAmllLyrics } from "@applemusic-like-lyrics/ttml";
import { DOMParser } from "@xmldom/xmldom";
import type { CompactLyricWord, SyncedLyricsPayload } from "@repo/types";
import {
  buildAccount,
  buildTrack,
  makeRequestKey,
  responseKey,
  decryptLyricifyResponse,
} from "../src/utils/lyricify-protocol.mjs";
import {
  canFetchLyricify,
  fetchLyricifyLyrics,
  type LyricifyLyricsEntry,
} from "../src/fetchers/lyricify.js";
import {
  detectLyricifyFormat,
  parseLyricifyLyrics,
} from "../src/parsers/lyricify.js";
import {
  compareLyricsCandidates,
  evaluateLyricsCandidate,
  LyricsEngine,
  type ResolvedLyricsResult,
} from "../src/engine.js";
import {
  convertCompactToAmllLines,
  formatLyricsPayload,
  optimizeLyricsPayload,
} from "../src/utils/converter.js";
import { globalProviderLimiter } from "@repo/music-resolver";

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/lyricify-protocol.json", import.meta.url),
    "utf8",
  ),
);
const query = {
  spotifyId: fixture.record.spotifyId,
  title: fixture.record.title,
  artists: fixture.record.artists,
  album: fixture.record.album,
  isrc: fixture.record.isrc,
  durationMs: fixture.record.durationMs,
};

function encrypted(data: unknown, wrapped = false): string {
  const cipher = createCipheriv(
    "aes-128-ecb",
    responseKey(fixture.account, fixture.track, wrapped),
    null,
  );
  const payload = Buffer.from(JSON.stringify(data)).toString("base64");
  const b64 = Buffer.concat([cipher.update(payload), cipher.final()]).toString(
    "base64",
  );
  return wrapped ? `ac ${b64} 0` : b64;
}

const entry: LyricifyLyricsEntry = {
  Verbatim:
    "[ti:Example]\n[ar:Artists]\n" +
    "[0,150]Example(0,150)\n[150,150]Composer credit(150,150)\n[300,150]Producer credit(300,150)\n" +
    "[1000,1000]Alpha (1000,500)one(1500,500)\n" +
    "[5000,1000](Bravo (5000,500)two)(5500,500)\n" +
    "[9000,1000]Charlie (9000,500)three(9500,500)\n" +
    "[13000,1000](Delta (13000,500)four)(13500,500)",
  DuetProperties: "0001122",
  TitleLines: 3,
  EndingLines: 0,
  Offset: 0,
  Trans:
    "[ti:Example]\n[00:01.000]第一句\n[00:05.000](第二句)\n[00:09.000]第三句\n[00:13.000](第四句)",
};

const words = (lyrics: SyncedLyricsPayload) =>
  lyrics.map((line) =>
    line.filter((word): word is CompactLyricWord => Array.isArray(word)),
  );

test("matches independent Python request and wrapped-response crypto fixtures", () => {
  assert.equal(
    makeRequestKey(buildAccount(fixture.env), buildTrack(fixture.record), "qq"),
    fixture.requestKey,
  );
  assert.deepEqual(
    decryptLyricifyResponse(
      fixture.responseBody,
      fixture.account,
      fixture.track,
    ),
    fixture.data,
  );
  assert.deepEqual(
    decryptLyricifyResponse(
      fixture.responseBody.replace(/ 0$/, "0"),
      fixture.account,
      fixture.track,
    ),
    fixture.data,
  );
});

test("bare responses use even MD5 characters and support full unknown JSON", () => {
  assert.equal(
    responseKey(fixture.account, fixture.track, false).toString(),
    "D4C6F7A7826E09FF",
  );
  assert.notEqual(
    responseKey(fixture.account, fixture.track, false).toString(),
    fixture.responseKey,
  );
  assert.deepEqual(
    decryptLyricifyResponse(
      fixture.bareResponseBody,
      fixture.account,
      fixture.track,
    ),
    fixture.data,
  );
  assert.deepEqual(
    decryptLyricifyResponse(
      encrypted({ Wxriw: entry }),
      fixture.account,
      fixture.track,
    ),
    { Wxriw: entry },
  );
  assert.throws(() =>
    decryptLyricifyResponse(
      "<html>upstream error</html>",
      fixture.account,
      fixture.track,
    ),
  );
});

test("fetcher skips missing configuration or metadata without contacting the server", async () => {
  const noFetch = async () => {
    assert.fail("Unexpected request");
  };
  assert.equal(canFetchLyricify(query, {}), false);
  for (const invalid of [
    { ...query, spotifyId: undefined },
    { ...query, durationMs: 0 },
    { ...query, artists: [] },
  ]) {
    assert.equal(
      await fetchLyricifyLyrics(invalid, { env: fixture.env, fetch: noFetch }),
      null,
    );
  }
  assert.equal(
    await fetchLyricifyLyrics(query, { env: {}, fetch: noFetch }),
    null,
  );
});

test("fetcher returns only Wxriw lyric fields and keeps sensitive failures out of logs", async () => {
  for (const wrapped of [false, true]) {
    const result = await fetchLyricifyLyrics(query, {
      env: fixture.env,
      fetch: async (url, options) => {
        assert.equal(
          new URL(String(url)).searchParams.get("key"),
          fixture.requestKey,
        );
        assert.equal(options?.redirect, "error");
        return new Response(
          encrypted(
            {
              Wxriw: {
                ...entry,
                Writer: "private",
                UserIds: ["private"],
                Locked: true,
              },
              QQ: { Text: "ignored" },
            },
            wrapped,
          ),
        );
      },
    });
    assert.deepEqual(result, entry);
  }
  assert.equal(
    await fetchLyricifyLyrics(query, {
      env: fixture.env,
      fetch: async () => new Response(encrypted({ Wxriw: null, QQ: entry })),
    }),
    null,
  );
  await assert.rejects(
    fetchLyricifyLyrics(query, {
      env: fixture.env,
      fetch: async (url) => {
        throw new Error(String(url));
      },
    }),
    /Lyricify request failed or timed out\.$/,
  );
  await assert.rejects(
    fetchLyricifyLyrics(query, {
      env: fixture.env,
      fetch: async () =>
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "30" },
        }),
    }),
    (error: Error & { status?: number; retryAfter?: string }) =>
      error.status === 429 && error.retryAfter === "30",
  );
});

test("QRC credits are removed after duet mapping; all four roles and translations survive", () => {
  const parsed = parseLyricifyLyrics(entry, { title: "Example" })!;
  assert.equal(parsed.format, "qrc");
  assert.equal(parsed.lyricsType, "word");
  const lyrics = parsed.lyrics as SyncedLyricsPayload;
  assert.equal(lyrics.length, 4);
  assert.deepEqual(
    words(lyrics).map((line) => line[0]![0]),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    words(lyrics).map((line) => line.map((word) => [word[1], word[2]])),
    [
      [
        [1000, 500],
        [1500, 500],
      ],
      [
        [5000, 500],
        [5500, 500],
      ],
      [
        [9000, 500],
        [9500, 500],
      ],
      [
        [13000, 500],
        [13500, 500],
      ],
    ],
  );
  assert.equal(parsed.hasTranslation, true);
  assert.equal(
    lyrics[0]!.filter((token) => typeof token === "string")[0],
    "第一句",
  );
  assert.ok(!JSON.stringify(lyrics).includes("credit"));
});

test("signed offsets apply once to words and translations despite header offset metadata", () => {
  for (const offset of [250, -250, -10000]) {
    const result = parseLyricifyLyrics({
      ...entry,
      Offset: offset,
      Verbatim: "[offset:100]\n" + entry.Verbatim,
      Trans: "[offset:100]\n" + entry.Trans,
    })!;
    const lyrics = result.lyrics as SyncedLyricsPayload;
    assert.equal(words(lyrics)[0]![0]![1], 1000 + offset);
    assert.equal(words(lyrics)[0]![0]![2], 500);
    assert.equal(
      lyrics[0]!.filter((token) => typeof token === "string")[0],
      "第一句",
    );
  }
});

test("word-timed translations share the DTO offset and preserve embedded annotations", () => {
  const result = parseLyricifyLyrics({
    ...entry,
    Offset: -10000,
    Trans: "[1000,1000]第一句(1000,1000)\n[9000,1000]第三句(9000,1000)",
  })!;
  const lyrics = result.lyrics as SyncedLyricsPayload;
  assert.equal(
    lyrics[0]!.filter((token) => typeof token === "string")[0],
    "第一句",
  );
  assert.equal(
    lyrics[2]!.filter((token) => typeof token === "string")[0],
    "第三句",
  );
  const embedded = convertCompactToAmllLines(
    parseLyricifyLyrics(entry)!.lyrics as SyncedLyricsPayload,
  );
  embedded[0]!.romanLyric = "embedded romaji";
  const quickExport = parseLyricifyLyrics({
    Verbatim: stringifyLqe(embedded),
  })!;
  assert.equal(quickExport.hasTranslation, true);
  assert.equal(quickExport.hasRomaji, true);
});

test("preserved conversion keeps timing, roles and grouping while unmasking", () => {
  const payload: SyncedLyricsPayload = [1, 2, 3, 4].map((role) => [
    [role as CompactLyricWord[0], 1000, 123, "It's "],
    [role as CompactLyricWord[0], 1200, 456, "Britney "],
    [role as CompactLyricWord[0], 1700, 789, "*****"],
  ]);
  const result = optimizeLyricsPayload(
    payload,
    undefined,
    ["It's Britney bitch"],
    undefined,
    true,
  );
  assert.deepEqual(
    words(result).map((line) => line.map((word) => word.slice(0, 3))),
    words(payload).map((line) => line.map((word) => word.slice(0, 3))),
  );
  assert.ok(words(result).every((line) => line[2]![3].trim() === "bitch"));
});

test("bad duet metadata, count mismatches, unsupported syntax, and empty lyrics become misses", () => {
  for (const bad of [
    { ...entry, DuetProperties: "12" },
    { ...entry, DuetProperties: "0001132" },
    { ...entry, TitleLines: 100 },
    { ...entry, Offset: NaN },
    { Verbatim: "<unconfirmed-format/>" },
    { Verbatim: "" },
    { Text: "Alpha\nBravo", DuetProperties: "0" },
  ]) {
    assert.equal(parseLyricifyLyrics(bad), null);
  }
  const ending = parseLyricifyLyrics({ ...entry, EndingLines: 1 })!;
  assert.equal((ending.lyrics as SyncedLyricsPayload).length, 3);
});

test("recognizes the installed formats without interpreting QRC as line lyrics", () => {
  const examples = {
    qrc: "[1000,1000]Alpha(1000,500)one(1500,500)",
    yrc: "[1000,1000](1000,500,0)Alpha (1500,500,0)one",
    lys: "[8](Alpha (1000,500)one)(1500,500)",
    lyl: "[type:LyricifyLines]\n[1000,2000]Alpha one",
    lrc: "[00:01.000]Alpha one\n[00:05.000]Bravo two",
    plain: "Alpha one\nBravo two\nCharlie three\nDelta four",
  };
  for (const [format, text] of Object.entries(examples)) {
    assert.equal(detectLyricifyFormat(text), format);
    assert.equal(parseLyricifyLyrics({ Verbatim: text })?.format, format);
  }
  const lqe = stringifyLqe(parseLys(examples.lys));
  const parsed = parseLyricifyLyrics({ Verbatim: lqe, DuetProperties: "0" })!;
  assert.equal(parsed.format, "lqe");
  assert.equal(words(parsed.lyrics as SyncedLyricsPayload)[0]![0]![0], 4);
});

test("ordered LRC retains duet indexes before sorting could move lines", () => {
  const parsed = parseLyricifyLyrics(
    { Text: "[00:05.000]Alpha\n[00:01.000](Bravo)", DuetProperties: "12" },
    { durationMs: 10000 },
  )!;
  assert.deepEqual(
    words(parsed.lyrics as SyncedLyricsPayload).map((line) => [
      line[0]![0],
      line[0]![1],
    ]),
    [
      [1, 5000],
      [4, 1000],
    ],
  );
});

test("JSON, TTML and Lyricify Syllable exports retain authored roles and timings", () => {
  const parsed = parseLyricifyLyrics(entry)!;
  const lyrics = parsed.lyrics as SyncedLyricsPayload;
  assert.deepEqual(formatLyricsPayload(lyrics, "json").content, lyrics);
  const ttml = formatLyricsPayload(lyrics, "ttml").content as string;
  assert.match(ttml, /ttm:agent="v2"/);
  assert.match(ttml, /ttm:role="x-bg"/);
  const roundTrip = toAmllLyrics(
    TTMLParser.parse(ttml, {
      domParser: new DOMParser() as unknown as NonNullable<
        ConstructorParameters<typeof TTMLParser>[0]
      >["domParser"],
    }),
  ).lines;
  assert.deepEqual(
    roundTrip.map((line) => [
      line.isDuet,
      line.isBG,
      line.words.map((word) => [word.startTime, word.endTime]),
    ]),
    convertCompactToAmllLines(lyrics).map((line) => [
      line.isDuet,
      line.isBG,
      line.words.map((word) => [word.startTime, word.endTime]),
    ]),
  );
  const lys = parseLys(formatLyricsPayload(lyrics, "lys").content as string);
  assert.deepEqual(
    lys.map((line) => [line.isDuet, line.isBG]),
    [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ],
  );
  assert.deepEqual(
    lys.map((line) => line.words.map((word) => [word.startTime, word.endTime])),
    convertCompactToAmllLines(lyrics).map((line) =>
      line.words.map((word) => [word.startTime, word.endTime]),
    ),
  );
});

test("Lyricify wins within each tier, while completeness and existing word-source order remain", () => {
  const lyrics: SyncedLyricsPayload = [0, 30000, 60000, 90000].map((start) => [
    [1, start, 10000, "Example phrase "],
  ]);
  for (const lyricsType of ["word", "line", "plain"] as const) {
    const make = (provider: string, complete = true): ResolvedLyricsResult => ({
      provider,
      source: "test",
      lyricsType,
      lyrics:
        lyricsType === "plain"
          ? complete
            ? "Alpha\nBravo\nCharlie\nDelta"
            : "Alpha"
          : complete
            ? lyrics
            : lyrics.slice(0, 1),
    });
    const candidates = [make("amll-db"), make("lrc-red"), make("Lyricify")]
      .map((candidate) => evaluateLyricsCandidate(candidate, 120000))
      .sort(compareLyricsCandidates);
    assert.equal(candidates[0]!.candidate.provider, "Lyricify");
    const fallback = [make("Lyricify", false), make("amll-db")]
      .map((candidate) => evaluateLyricsCandidate(candidate, 120000))
      .sort(compareLyricsCandidates);
    assert.equal(fallback[0]!.candidate.provider, "amll-db");
  }
});

test("engine caches one Lyricify fetch across tiers, preserves own translations, and reports Lyricify", async (t) => {
  for (const [key, value] of Object.entries(fixture.env) as [
    string,
    string,
  ][]) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(
    globalProviderLimiter,
    "schedule",
    async (_provider: string, task: () => Promise<unknown>) => task(),
  );
  t.mock.method(
    globalProviderLimiter,
    "isAvailable",
    (provider: string) => provider !== "musixmatch",
  );
  let calls = 0;
  const lineEntry = {
    Text: "[00:01.000]Alpha one\n[00:31.000]Bravo two\n[01:01.000]Charlie three\n[01:31.000]Delta four",
    Trans: "[00:01.000]第一句",
    DuetProperties: "1122",
  };
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    if (String(url).startsWith("https://api.lyricify.app/")) {
      calls++;
      return new Response(encrypted({ Wxriw: lineEntry }));
    }
    return new Response("missing", { status: 404 });
  });
  const progress: string[] = [];
  const result = await new LyricsEngine().resolveLyrics({
    ...query,
    onProgress: (event) => progress.push(event.provider),
  });
  assert.equal(calls, 1);
  assert.equal(result?.provider, "Lyricify");
  assert.equal(result?.lyricsType, "line");
  assert.equal(result?.hasTranslation, true);
  assert.ok(progress.includes("Lyricify"));
  assert.deepEqual(
    words(result!.lyrics as SyncedLyricsPayload).map((line) => line[0]![0]),
    [1, 1, 3, 3],
  );
});

test("engine prefers complete Lyricify words, but falls back to AMLL for line timing or bad responses", async (t) => {
  for (const [key, value] of Object.entries(fixture.env) as [
    string,
    string,
  ][]) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(
    globalProviderLimiter,
    "schedule",
    async (_provider: string, task: () => Promise<unknown>) => task(),
  );
  t.mock.method(
    globalProviderLimiter,
    "isAvailable",
    (provider: string) => provider !== "musixmatch",
  );
  const starts = [1000, 51000, 101000, 151000];
  const complete = starts
    .map(
      (start, index) =>
        `[${start},10000]Vocal${index} (${start},5000)phrase(${start + 5000},5000)`,
    )
    .join("\n");
  const payload: SyncedLyricsPayload = starts.map((start) => [
    [1, start, 5000, "Another "],
    [1, start + 5000, 5000, "phrase "],
  ]);
  const ttml = formatLyricsPayload(payload, "ttml").content as string;
  const responses = [
    {
      body: encrypted({
        Wxriw: { Verbatim: complete, DuetProperties: "1122" },
      }),
      status: 200,
      expected: "Lyricify",
    },
    {
      body: encrypted({
        Wxriw: {
          Text: "[00:01.000]Alpha\n[00:51.000]Bravo\n[01:41.000]Charlie\n[02:31.000]Delta",
        },
      }),
      status: 200,
      expected: "amll-db",
    },
    {
      body: encrypted({ Wxriw: { Verbatim: complete, DuetProperties: "12" } }),
      status: 200,
      expected: "amll-db",
    },
    { body: "upstream error", status: 500, expected: "amll-db" },
  ];
  for (const response of responses) {
    let calls = 0;
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async (url: string | URL) => {
        if (String(url).startsWith("https://api.lyricify.app/")) {
          calls++;
          return new Response(response.body, { status: response.status });
        }
        if (
          String(url).includes(
            "raw.githubusercontent.com/amll-dev/amll-ttml-db",
          )
        )
          return new Response(ttml);
        return new Response("missing", { status: 404 });
      },
    );
    const result = await new LyricsEngine().resolveLyrics(query);
    assert.equal(calls, 1);
    assert.equal(result?.provider, response.expected);
    assert.equal(result?.lyricsType, "word");
    mock.mock.restore();
  }
});
