import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SyncedLyricsPayload } from "@repo/types";
import {
  extractBackgroundVocals,
  optimizeLyricsPayload,
  formatLyricsPayload,
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
});
