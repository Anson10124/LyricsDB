import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CompactLyricWord, SyncedLyricsPayload } from "@repo/types";
import {
  extractBackgroundVocals,
  optimizeLyricsPayload,
  formatLyricsPayload,
  alignTranslationsAndRomaji,
  convertCompactToAmllLines,
  convertAmllLinesToCompact,
} from "../src/index.js";

describe("Background Vocals Extraction", () => {
  it("should extract parenthesized background vocal from word-by-word line to type 2 with time preserved", () => {
    // User Example 1:
    // [00:39.960] But I know they'll never own me （Yeah）
    const input: SyncedLyricsPayload = [
      [
        [1, 39960, 300, "But "],
        [1, 40260, 90, "I "],
        [1, 40350, 240, "know "],
        [1, 40590, 360, "they'll "],
        [1, 40950, 390, "never "],
        [1, 41340, 270, "own "],
        [1, 41610, 270, "me "],
        [1, 41880, 180, "（"],
        [1, 42060, 750, "Yeah"],
        [1, 42810, 390, "） "],
      ],
    ];

    const result = extractBackgroundVocals(input);
    assert.equal(result.length, 2);

    // Lead line (Type 1)
    const leadLine = result[0]!;
    assert.equal(leadLine.length, 7);
    assert.equal(leadLine[0]![0], 1);
    assert.equal(
      leadLine.map((w) => w[3]).join(""),
      "But I know they'll never own me ",
    );
    assert.equal(leadLine[0]![1], 39960);
    assert.equal(leadLine[6]![1], 41610);

    // Background line (Type 2)
    const bgLine = result[1]!;
    assert.equal(bgLine.length, 1);
    assert.equal(bgLine[0]![0], 2); // vocalType 2
    assert.equal(bgLine[0]![1], 42060); // startMs
    assert.equal(bgLine[0]![3], "Yeah "); // parentheses stripped, trailing space ensured
  });

  it("should extract background vocal from single token line to type 2", () => {
    // User Example 2:
    // Run from the sun like Dracula (run from the sun)
    const input: SyncedLyricsPayload = [
      [
        [
          1,
          102290,
          3960,
          "Run from the sun like Dracula (run from the sun) ",
        ],
      ],
    ];

    const result = extractBackgroundVocals(input);
    assert.equal(result.length, 2);

    // Lead line (Type 1)
    const leadLine = result[0]!;
    assert.equal(leadLine[0]![0], 1);
    assert.equal(leadLine[0]![3], "Run from the sun like Dracula ");
    assert.equal(leadLine[0]![1], 102290);

    // Background line (Type 2)
    const bgLine = result[1]!;
    assert.equal(bgLine[0]![0], 2);
    assert.equal(bgLine[0]![3], "run from the sun ");
    assert.ok(bgLine[0]![1] > 102290); // starts after lead part
  });

  it("should convert entire line enclosed in parentheses to type 2", () => {
    const input: SyncedLyricsPayload = [
      [
        [1, 15000, 300, "(Run "],
        [1, 15300, 300, "from "],
        [1, 15600, 200, "the "],
        [1, 15800, 400, "sun) "],
      ],
    ];

    const result = extractBackgroundVocals(input);
    assert.equal(result.length, 1);

    const bgLine = result[0]!;
    assert.equal(bgLine[0]![0], 2);
    assert.equal(bgLine[1]![0], 2);
    assert.equal(bgLine[2]![0], 2);
    assert.equal(bgLine[3]![0], 2);
    assert.equal(
      bgLine.map((w) => w[3]).join(""),
      "Run from the sun ",
    );
  });

  it("should map duet lead lines (type 3) with background vocals to duet background (type 4)", () => {
    const input: SyncedLyricsPayload = [
      [
        [3, 20000, 400, "Hold "],
        [3, 20400, 400, "on "],
        [3, 20800, 300, "(hold "],
        [3, 21100, 400, "on) "],
      ],
    ];

    const result = extractBackgroundVocals(input);
    assert.equal(result.length, 2);

    const leadLine = result[0]!;
    assert.equal(leadLine[0]![0], 3);
    assert.equal(leadLine.map((w) => w[3]).join(""), "Hold on ");

    const bgLine = result[1]!;
    assert.equal(bgLine[0]![0], 4); // Duet background is type 4
    assert.equal(bgLine.map((w) => w[3]).join(""), "hold on ");
  });

  it("should extract bracketed translation and assign to background vocal line", () => {
    // User Example from Rap God:
    // Main: Something's wrong, I can feel it (Six minutes, Slim Shady, you're on)
    // Translation: 有什么不对劲，我能感觉到（六分钟，Slim Shady，该你出场了）
    const input: SyncedLyricsPayload = [
      [
        [1, 1000, 300, "Something's "],
        [1, 1300, 300, "wrong, "],
        [1, 1600, 200, "I "],
        [1, 1800, 200, "can "],
        [1, 2000, 300, "feel "],
        [1, 2300, 300, "it "],
        [1, 2600, 300, "(Six "],
        [1, 2900, 300, "minutes, "],
        [1, 3200, 300, "Slim "],
        [1, 3500, 300, "Shady, "],
        [1, 3800, 300, "you're "],
        [1, 4100, 300, "on) "],
        "有什么不对劲，我能感觉到（六分钟，Slim Shady，该你出场了）",
        "Something's wrong, I can feel it (Six minutes, Slim Shady, you're on)",
      ],
    ];

    const result = extractBackgroundVocals(input);
    assert.equal(result.length, 2);

    // Lead line (Type 1)
    const leadLine = result[0]!;
    const leadWords = leadLine.filter(
      (w): w is CompactLyricWord => Array.isArray(w),
    );
    const leadStrings = leadLine.filter(
      (w): w is string => typeof w === "string",
    );
    assert.equal(leadWords[0]![0], 1);
    assert.equal(
      leadWords.map((w) => w[3]).join(""),
      "Something's wrong, I can feel it ",
    );
    assert.equal(leadStrings[0], "有什么不对劲，我能感觉到");
    assert.equal(leadStrings[1], "Something's wrong, I can feel it");

    // Background line (Type 2)
    const bgLine = result[1]!;
    const bgWords = bgLine.filter(
      (w): w is CompactLyricWord => Array.isArray(w),
    );
    const bgStrings = bgLine.filter((w): w is string => typeof w === "string");
    assert.equal(bgWords[0]![0], 2);
    assert.equal(
      bgWords.map((w) => w[3]).join(""),
      "Six minutes, Slim Shady, you're on ",
    );
    assert.equal(bgStrings[0], "六分钟，Slim Shady，该你出场了");
    assert.equal(bgStrings[1], "Six minutes, Slim Shady, you're on");
  });

  it("should clean bracketed translation on lead line and forward to subsequent line if missing translation", () => {
    const input: SyncedLyricsPayload = [
      [
        [1, 1000, 1000, "Something's wrong, I can feel it "],
        "有什么不对劲，我能感觉到（六分钟，Slim Shady，该你出场了）",
      ],
      [
        [1, 2500, 1500, "Six minutes, Slim Shady, you're on "],
      ],
    ];

    const result = extractBackgroundVocals(input);
    assert.equal(result.length, 2);

    // Lead line 1 has bracketed text removed
    const line1Strings = result[0]!.filter((w): w is string => typeof w === "string");
    assert.equal(line1Strings[0], "有什么不对劲，我能感觉到");

    // Line 2 receives the extracted background translation
    const line2Strings = result[1]!.filter((w): w is string => typeof w === "string");
    assert.equal(line2Strings[0], "六分钟，Slim Shady，该你出场了");
  });

  it("should strip enclosing brackets on full-line background translation", () => {
    const input: SyncedLyricsPayload = [
      [
        [1, 1000, 1000, "(Run from the sun) "],
        "（逃离太阳）",
        "(Run from the sun)",
      ],
    ];

    const result = extractBackgroundVocals(input);
    assert.equal(result.length, 1);

    const lineStrings = result[0]!.filter((w): w is string => typeof w === "string");
    assert.equal(lineStrings[0], "逃离太阳");
    assert.equal(lineStrings[1], "Run from the sun");
  });

  it("should generate correct TTML with ttm:role='x-bg' for extracted background vocals", () => {
    const input: SyncedLyricsPayload = [
      [
        [1, 39960, 300, "But "],
        [1, 40260, 90, "I "],
        [1, 40350, 240, "know "],
        [1, 40590, 360, "they'll "],
        [1, 40950, 390, "never "],
        [1, 41340, 270, "own "],
        [1, 41610, 270, "me "],
        [1, 41880, 180, "（"],
        [1, 42060, 750, "Yeah"],
        [1, 42810, 390, "） "],
      ],
    ];

    const optimized = optimizeLyricsPayload(input);
    const ttmlResult = formatLyricsPayload(optimized, "ttml");

    assert.equal(ttmlResult.contentType, "application/xml; charset=utf-8");
    const xml = ttmlResult.content as string;

    // Check that TTML has lead line and a background line with ttm:role="x-bg"
    assert.ok(xml.includes('ttm:role="x-bg"'));
    assert.ok(xml.includes("Yeah"));
  });

  it("should assign background vocal translation when aligning translations with candidate lines (Rap God example)", () => {
    const rawPayload: SyncedLyricsPayload = [
      [
        [1, 9900, 510, "Something's "],
        [1, 10410, 570, "wrong, "],
        [1, 10980, 120, "I "],
        [1, 11100, 240, "can "],
        [1, 11340, 300, "feel "],
        [1, 11640, 1320, "it "],
      ],
      [
        [2, 9900, 2040, "Six "],
        [2, 11940, 180, "minutes, "],
        [2, 12120, 360, "Slim "],
        [2, 12480, 270, "Shady, "],
        [2, 12750, 150, "you're "],
        [2, 12900, 60, "on "],
      ],
    ];

    const translationLrc = "[00:09.90]有什么不对劲，我能感觉到（六分钟，Slim Shady，该你出场了）\n";

    const amllLines = convertCompactToAmllLines(rawPayload);
    const enriched = alignTranslationsAndRomaji(amllLines, {
      translation: translationLrc,
    });

    assert.equal(enriched[0]?.translatedLyric, "有什么不对劲，我能感觉到");
    assert.equal(enriched[1]?.translatedLyric, "六分钟，Slim Shady，该你出场了");

    const compact = convertAmllLinesToCompact(enriched);
    assert.equal(compact.length, 2);

    const line1Strings = compact[0]!.filter((w): w is string => typeof w === "string");
    assert.equal(line1Strings[0], "有什么不对劲，我能感觉到");

    const line2Strings = compact[1]!.filter((w): w is string => typeof w === "string");
    assert.equal(line2Strings[0], "六分钟，Slim Shady，该你出场了");
  });
});
