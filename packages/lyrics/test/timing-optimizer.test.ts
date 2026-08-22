import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CompactLyricLine, SyncedLyricsPayload } from "@repo/types";
import {
  cleanUnintentionalOverlaps,
  syncMainAndBackgroundLines,
  convertExcessiveBackgroundLines,
  tryAdvanceStartTime,
  optimizeTiming,
  optimizeLyricsPayload,
  getLineEndMs,
  getLineStartMs,
  getLineWords,
} from "../src/index.js";

function createLine(
  startMs = 0,
  endMs = 0,
  text = "line ",
  vocalType = 1,
): CompactLyricLine {
  const durationMs = Math.max(0, endMs - startMs);
  return [[vocalType as 1 | 2 | 3 | 4, startMs, durationMs, text]];
}

describe("Timing & Overlap Optimizer", () => {
  describe("Excessive Background Lines Conversion", () => {
    it("converts a leading background line at index 0 to lead vocal", () => {
      const leadingBg = createLine(1000, 2000, "leading bg ", 2);
      const mainLine = createLine(3000, 4000, "main line ", 1);
      const payload: SyncedLyricsPayload = [leadingBg, mainLine];

      const result = convertExcessiveBackgroundLines(payload);

      assert.equal(getLineWords(result[0]!)[0]![0], 1); // converted to lead (1)
      assert.equal(getLineWords(result[1]!)[0]![0], 1);
    });

    it("converts consecutive background lines to lead vocals keeping only one background line", () => {
      const payload: SyncedLyricsPayload = [
        createLine(1000, 2000, "main ", 1),
        createLine(1500, 2500, "bg 1 ", 2),
        createLine(2000, 3000, "bg 2 ", 2),
        createLine(2500, 3500, "bg 3 ", 2),
      ];

      const result = convertExcessiveBackgroundLines(payload);
      const vocalTypes = result.map((line) => getLineWords(line)[0]![0]);

      assert.deepEqual(vocalTypes, [1, 2, 1, 1]);
    });

    it("handles duet background (type 4) conversion to duet lead (type 3)", () => {
      const payload: SyncedLyricsPayload = [
        createLine(1000, 2000, "duet lead ", 3),
        createLine(1200, 2200, "duet bg 1 ", 4),
        createLine(1400, 2400, "duet bg 2 ", 4),
      ];

      const result = convertExcessiveBackgroundLines(payload);
      const vocalTypes = result.map((line) => getLineWords(line)[0]![0]);

      assert.deepEqual(vocalTypes, [3, 4, 3]);
    });
  });

  describe("Main and Background Lines Synchronization", () => {
    it("synchronizes the end time of main and attached background lines", () => {
      const mainLine = createLine(1000, 2000, "main line ", 1);
      const bgLine = createLine(1200, 2300, "bg line ", 2);
      const payload: SyncedLyricsPayload = [mainLine, bgLine];

      const result = syncMainAndBackgroundLines(payload);

      assert.equal(getLineEndMs(getLineWords(result[0]!)), 2300);
      assert.equal(getLineEndMs(getLineWords(result[1]!)), 2300);
    });

    it("synchronizes when main line lasts longer than background line", () => {
      const mainLine = createLine(1000, 3000, "main line ", 1);
      const bgLine = createLine(1500, 2000, "bg line ", 2);
      const payload: SyncedLyricsPayload = [mainLine, bgLine];

      const result = syncMainAndBackgroundLines(payload);

      assert.equal(getLineEndMs(getLineWords(result[0]!)), 3000);
      assert.equal(getLineEndMs(getLineWords(result[1]!)), 3000);
    });
  });

  describe("Unintentional Overlap Cleaning", () => {
    const boundaryCases: Array<{
      name: string;
      overlap: number;
      duration: number;
      expectedEndTime: number;
    }> = [
      { name: "100ms overlap (unintentional)", overlap: 100, duration: 1000, expectedEndTime: 1000 },
      { name: "just over 100ms and 10% (101ms - intentional)", overlap: 101, duration: 1000, expectedEndTime: 1101 },
      { name: "exactly 10% (200ms / 2000ms - unintentional)", overlap: 200, duration: 2000, expectedEndTime: 1000 },
      { name: "just over 10% (201ms / 2000ms - intentional)", overlap: 201, duration: 2000, expectedEndTime: 1201 },
      { name: "499ms below 10% (499ms / 10000ms - unintentional)", overlap: 499, duration: 10000, expectedEndTime: 1000 },
      { name: "500ms regardless of percentage (intentional)", overlap: 500, duration: 10000, expectedEndTime: 1500 },
    ];

    for (const testCase of boundaryCases) {
      it(`classifies ${testCase.name}`, () => {
        const line = createLine(0, 1000 + testCase.overlap, "line 1 ", 1);
        const nextLine = createLine(1000, 1000 + testCase.duration, "line 2 ", 1);

        const result = cleanUnintentionalOverlaps([line, nextLine]);
        assert.equal(getLineEndMs(getLineWords(result[0]!)), testCase.expectedEndTime);
      });
    }

    it("checks later overlapping lines after an intentional overlap", () => {
      const longLine = createLine(0, 3000, "A ", 1);
      const intentionalOverlap = createLine(1000, 2500, "B ", 1);
      const slightOverlap = createLine(2950, 3950, "C ", 1);

      const result = cleanUnintentionalOverlaps([longLine, intentionalOverlap, slightOverlap]);

      // Line A intentionally overlaps Line B (1500ms >= 500ms), but only overlaps Line C by 50ms (<= 100ms)
      // So Line A should be truncated to Line C's start (2950ms)
      assert.equal(getLineEndMs(getLineWords(result[0]!)), 2950);
    });

    it("syncs attached background line end time when cleaning overlaps", () => {
      const mainLine = createLine(0, 1100, "main ", 1);
      const bgLine = createLine(100, 1050, "bg ", 2);
      const nextMainLine = createLine(1000, 2000, "next ", 1);

      const result = cleanUnintentionalOverlaps([mainLine, bgLine, nextMainLine], true);

      assert.equal(getLineEndMs(getLineWords(result[0]!)), 1000);
      assert.equal(getLineEndMs(getLineWords(result[1]!)), 1000);
    });
  });

  describe("Start Time Advancement", () => {
    it("advances the first line by up to 600ms clamped at 0", () => {
      const line1 = createLine(1000, 2000, "late ", 1);
      const line2 = createLine(400, 800, "early ", 1);

      const result1 = tryAdvanceStartTime([line1]);
      const result2 = tryAdvanceStartTime([line2]);

      assert.equal(getLineStartMs(getLineWords(result1[0]!)), 400); // 1000 - 600
      assert.equal(getLineStartMs(getLineWords(result2[0]!)), 0); // 400 - 600 clamped to 0
    });

    const advanceCases: Array<{
      name: string;
      startMs: number;
      endMs: number;
      expectedStart: number;
    }> = [
      { name: "a sufficient gap", startMs: 3000, endMs: 4000, expectedStart: 2400 },
      { name: "an exact boundary", startMs: 2000, endMs: 3000, expectedStart: 2000 },
      { name: "a 100ms overlap", startMs: 1900, endMs: 2900, expectedStart: 1830 },
      { name: "a 400ms overlap", startMs: 1600, endMs: 2600, expectedStart: 1200 },
      { name: "an overlap greater than 400ms", startMs: 1100, endMs: 2100, expectedStart: 700 },
    ];

    for (const testCase of advanceCases) {
      it(`advances following line with ${testCase.name}`, () => {
        const firstLine = createLine(1000, 2000, "first ", 1);
        const secondLine = createLine(testCase.startMs, testCase.endMs, "second ", 1);

        const result = tryAdvanceStartTime([firstLine, secondLine]);
        assert.equal(getLineStartMs(getLineWords(result[1]!)), testCase.expectedStart);
      });
    }

    it("synchronizes attached background line start time when advance is enabled", () => {
      const mainLine = createLine(1000, 2000, "main ", 1);
      const bgLine = createLine(1500, 1800, "bg ", 2);

      const result = tryAdvanceStartTime([mainLine, bgLine], true);

      assert.equal(getLineStartMs(getLineWords(result[0]!)), 400);
      assert.equal(getLineStartMs(getLineWords(result[1]!)), 400);
    });
  });

  describe("Integration in optimizeLyricsPayload & optimizeTiming", () => {
    it("cleans accidental overlaps and synchronizes background vocals seamlessly", () => {
      const payload: SyncedLyricsPayload = [
        [
          [1, 10000, 1000, "Hello "],
          [1, 11000, 1050, "world "], // ends at 12050
        ],
        [
          [1, 12000, 2000, "Next "],
          [1, 14000, 1000, "line "], // starts at 12000, overlap is 50ms (unintentional)
        ],
      ];

      const optimized = optimizeLyricsPayload(payload);
      assert.equal(getLineEndMs(getLineWords(optimized[0]!)), 12000); // clamped from 12050 to 12000

      const directOptimized = optimizeTiming(payload, { cleanUnintentionalOverlaps: true });
      assert.equal(getLineEndMs(getLineWords(directOptimized[0]!)), 12000);
    });
  });
});
