import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatLyricsPayload,
  convertAmllLinesToCompact,
  convertCompactToAmllLines,
} from "../src/utils/converter.js";
import { parseTtml } from "../src/parsers/ttml.js";
import { parseYrc } from "../src/parsers/yrc.js";
import type { SyncedLyricsPayload } from "@repo/types";

describe("TTML Word Spacing & Formatting", () => {
  it("should format compact lyrics to TTML and inspect output", () => {
    const sampleCompact: SyncedLyricsPayload = [
      [
        [1, 13748, 289, "In "],
        [1, 14037, 176, "a "],
        [1, 14213, 663, "happy "],
        [1, 14876, 863, "home "],
        [1, 16222, 223, "I "],
        [1, 16445, 208, "was "],
        [1, 16653, 223, "a "],
        [1, 16876, 336, "king "],
        [1, 17212, 168, "I "],
        [1, 17380, 240, "had "],
        [1, 17620, 224, "a "],
        [1, 17844, 536, "golden "],
        [1, 18380, 801, "throne"],
        "在这个快乐的家庭我就像国王一样有一把黄金宝座，无忧无虑",
        "",
      ],
    ];

    const formatted = formatLyricsPayload(sampleCompact, "ttml");
    console.log("=== FORMATTED TTML ===");
    console.log(formatted.content);

    const parsedBack = parseTtml(formatted.content as string);
    console.log("=== PARSED BACK COMPACT ===");
    console.log(JSON.stringify(parsedBack, null, 2));
  });

  it("should handle split syllables like 'under' + 'stand ' correctly", () => {
    const syllableCompact: SyncedLyricsPayload = [
      [
        [1, 17380, 240, "do "],
        [1, 17620, 224, "you "],
        [1, 17844, 536, "under"],
        [1, 18380, 801, "stand "],
        [1, 18880, 801, "me?"],
      ],
    ];

    const formatted = formatLyricsPayload(syllableCompact, "ttml");
    const ttmlStr = formatted.content as string;

    assert.ok(ttmlStr.includes('>do </span>'));
    assert.ok(ttmlStr.includes('>you </span>'));
    assert.ok(ttmlStr.includes('>under</span>')); // MUST NOT have space!
    assert.ok(ttmlStr.includes('>stand </span>')); // MUST have space!
    assert.ok(ttmlStr.includes('>me?</span>')); // Last word has no trailing space in TTML!

    const parsedBack = parseTtml(ttmlStr);

    const lineWords = parsedBack[0]!.filter((w): w is [number, number, number, string] => Array.isArray(w));
    assert.equal(lineWords[0]![3].toLowerCase(), "do ");
    assert.equal(lineWords[1]![3].toLowerCase(), "you ");
    assert.equal(lineWords[2]![3], "under"); // Preserved without space
    assert.equal(lineWords[3]![3], "stand ");
    assert.equal(lineWords[4]![3], "me? ");
  });

  it("should handle background vocals and role attributes", () => {
    const bgCompact: SyncedLyricsPayload = [
      [
        [2, 13748, 289, "In "],
        [2, 14037, 176, "a "],
        [2, 14213, 663, "happy "],
        [2, 14876, 863, "home"],
      ],
    ];

    const formatted = formatLyricsPayload(bgCompact, "ttml");
    const ttmlStr = formatted.content as string;

    assert.ok(ttmlStr.includes('ttm:role="x-bg"'));
    assert.ok(ttmlStr.includes('>In </span>'));
    assert.ok(ttmlStr.includes('>a </span>'));
    assert.ok(ttmlStr.includes('>happy </span>'));
    assert.ok(ttmlStr.includes('>home</span>'));
  });

  it("should handle Chinese CJK characters without inserting unwanted spaces", () => {
    const zhCompact: SyncedLyricsPayload = [
      [
        [1, 1000, 500, "在"],
        [1, 1500, 500, "这"],
        [1, 2000, 500, "个"],
        [1, 2500, 500, "家"],
        [1, 3000, 500, "庭"],
      ],
    ];

    const formatted = formatLyricsPayload(zhCompact, "ttml");
    const ttmlStr = formatted.content as string;

    assert.ok(ttmlStr.includes('>在</span>'));
    assert.ok(ttmlStr.includes('>这</span>'));
    assert.ok(ttmlStr.includes('>个</span>'));
    assert.ok(ttmlStr.includes('>家</span>'));
    assert.ok(ttmlStr.includes('>庭</span>'));
  });

  it("should handle duets with v1 and v2 agents", () => {
    const duetCompact: SyncedLyricsPayload = [
      [
        [1, 1000, 500, "Lead "],
        [1, 1500, 500, "singer"],
      ],
      [
        [3, 2000, 500, "Duet "],
        [3, 2500, 500, "partner"],
      ],
    ];

    const formatted = formatLyricsPayload(duetCompact, "ttml");
    const ttmlStr = formatted.content as string;

    assert.ok(ttmlStr.includes('ttm:agent="v1"'));
    assert.ok(ttmlStr.includes('ttm:agent="v2"'));
    assert.ok(ttmlStr.includes('>Lead </span>'));
    assert.ok(ttmlStr.includes('>singer</span>'));
    assert.ok(ttmlStr.includes('>Duet </span>'));
    assert.ok(ttmlStr.includes('>partner</span>'));
  });
});
