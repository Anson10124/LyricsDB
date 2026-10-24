import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatLyricsPayload, optimizeTiming } from "../src/utils/converter.js";
import { parseTtml } from "../src/parsers/ttml.js";
import type { SyncedLyricsPayload } from "@repo/types";
import { DOMParser } from "@xmldom/xmldom";

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

function parseParagraphs(ttml: string): Element[] {
  const doc = new DOMParser().parseFromString(ttml, "text/xml");
  return Array.from(doc.getElementsByTagName("p")) as unknown as Element[];
}

function childSpans(el: Element): Element[] {
  return Array.from(el.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && node.nodeName === "span",
  );
}

function bgSpanOf(p: Element): Element | undefined {
  return childSpans(p).find((span) => span.getAttribute("ttm:role") === "x-bg");
}

describe("TTML background vocals", () => {
  it("keeps the background span's own begin time instead of the main line's", () => {
    const payload: SyncedLyricsPayload = [
      [
        [1, 80863, 207, "Y "],
        [1, 81070, 4496, "hacer"],
      ],
      [
        [2, 83300, 321, "Sube-"],
        [2, 83621, 351, "sube, "],
        [2, 83972, 1594, "sube"],
      ],
    ];

    const ttml = formatLyricsPayload(optimizeTiming(payload), "ttml").content as string;
    const [p] = parseParagraphs(ttml);
    const bgSpan = bgSpanOf(p!)!;
    const bgWords = childSpans(bgSpan);

    assert.equal(p!.getAttribute("begin"), "1:20.863");
    assert.equal(bgSpan.getAttribute("begin"), "1:23.300");
    assert.equal(bgWords[0]!.getAttribute("begin"), "1:23.300");
    assert.equal(bgWords[0]!.getAttribute("end"), "1:23.621");
  });

  it("stretches only the <p> window, not the main words, when the background starts first", () => {
    const payload: SyncedLyricsPayload = [
      [[1, 2000, 1000, "main"]],
      [[2, 1500, 2000, "early"]],
    ];

    const [p] = parseParagraphs(formatLyricsPayload(payload, "ttml").content as string);
    const [mainWord] = childSpans(p!);

    assert.equal(p!.getAttribute("begin"), "1.500");
    assert.equal(p!.getAttribute("end"), "3.500");
    assert.equal(mainWord!.getAttribute("begin"), "2.000");
    assert.equal(mainWord!.getAttribute("end"), "3.000");
  });

  it("targets the right <p> for roles and spacing once background lines are nested", () => {
    const payload: SyncedLyricsPayload = [
      [[1, 1000, 500, "Quiero "], [1, 1500, 500, "ver"]],
      [[2, 1200, 400, "uh-"], [2, 1600, 400, "oh"]],
      [[1, 3000, 500, "Que "], [1, 3500, 500, "le"]],
      [[2, 3200, 300, "uh-oh, "], [2, 3500, 300, "uh-oh"]],
      [[3, 5000, 300, "Tus "], [3, 5300, 300, "lugares "], [3, 5600, 300, "favoritos"]],
    ];

    const ps = parseParagraphs(formatLyricsPayload(payload, "ttml").content as string);

    assert.equal(ps.length, 3);
    for (const p of ps) assert.equal(p.getAttribute("ttm:role"), null);
    assert.deepEqual(
      ps.map((p) => p.getAttribute("ttm:agent")),
      ["v1", "v1", "v2"],
    );
    assert.deepEqual(
      childSpans(ps[2]!).map((span) => span.textContent),
      ["Tus ", "lugares ", "favoritos"],
    );
    assert.deepEqual(
      childSpans(bgSpanOf(ps[1]!)!).map((span) => span.textContent),
      ["(uh-oh, ", "uh-oh)"],
    );
  });

  it("gives a background line that cannot nest its own x-bg <p>", () => {
    const payload: SyncedLyricsPayload = [
      [[1, 1000, 1000, "main"]],
      [[2, 1200, 400, "first"]],
      [[2, 1600, 400, "second"]],
    ];

    const ps = parseParagraphs(formatLyricsPayload(payload, "ttml").content as string);

    assert.equal(ps.length, 2);
    assert.equal(ps[0]!.getAttribute("ttm:role"), null);
    assert.equal(ps[1]!.getAttribute("ttm:role"), "x-bg");
    assert.deepEqual(
      childSpans(bgSpanOf(ps[0]!)!).map((span) => span.textContent),
      ["(first)"],
    );
  });
});
