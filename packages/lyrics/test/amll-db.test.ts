import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchAmllDbLyrics } from "../src/fetchers/amll-db.js";
import { parseTtml } from "../src/parsers/ttml.js";
import { formatLyricsPayload } from "../src/utils/converter.js";
import { LyricsEngine } from "../src/engine.js";
import type { CompactLyricWord, SyncedLyricsPayload } from "@repo/types";

describe("AMLL TTML DB Fetcher & Parser", () => {
  it("should return null when no platform IDs are provided", async () => {
    const res = await fetchAmllDbLyrics({});
    assert.equal(res, null);
  });

  it("should return null for non-existent track IDs", async () => {
    const res = await fetchAmllDbLyrics({
      neteaseId: "999999999999999999",
      appleMusicId: "999999999999999999",
    });
    assert.equal(res, null);
  });

  it("should parse sample AMLL TTML with translations, romaji, and background vocals", () => {
    const sampleCompact: SyncedLyricsPayload = [
      [
        [1, 5000, 800, "Hello "],
        [1, 5800, 700, "world "],
        [1, 6500, 2000, "today"],
        "你好世界",
        "ni hao shi jie",
      ],
      [
        [2, 6000, 1000, "Background "],
        [2, 7000, 1500, "vocals"],
      ],
      [
        [3, 13000, 1000, "Duet "],
        [3, 14000, 2000, "singer"],
      ],
    ];

    const formatted = formatLyricsPayload(sampleCompact, "ttml");
    const parsed = parseTtml(formatted.content as string, { title: "Test Song", artist: "Test Artist" });
    assert.equal(parsed.length, 3);

    // Line 1: Lead (vocalType 1) with translation & romaji
    const line1 = parsed[0]!;
    const line1Words = line1.filter((item): item is CompactLyricWord => Array.isArray(item));
    const line1Strings = line1.filter((item): item is string => typeof item === "string");

    assert.equal(line1Words.length, 3);
    assert.equal(line1Words[0]![0], 1); // Main Lead
    assert.equal(line1Words[0]![3], "Hello ");
    assert.equal(line1Strings[0], "你好世界");
    assert.equal(line1Strings[1], "ni hao shi jie");

    // Line 2: Background (vocalType 2)
    const line2 = parsed[1]!;
    const line2Words = line2.filter((item): item is CompactLyricWord => Array.isArray(item));
    assert.equal(line2Words[0]![0], 2); // Main Background

    // Line 3: Duet (vocalType 3)
    const line3 = parsed[2]!;
    const line3Words = line3.filter((item): item is CompactLyricWord => Array.isArray(item));
    assert.equal(line3Words[0]![0], 3); // Secondary Lead / Duet
  });

  it("should resolve lyrics via LyricsEngine with AMLL DB as provider", async () => {
    const engine = new LyricsEngine();

    // Using real NetEase ID from AMLL TTML DB repository (YOASOBI - Idol: 2048982668 or 1987638572)
    const result = await engine.resolveLyrics({
      title: "かくれんぼ",
      artist: "RUQOA",
      neteaseId: "1987638572",
      durationMs: 180000,
    });

    assert.ok(result);
    assert.equal(result.lyricsType, "word");
    assert.equal(result.provider, "amll-db");
    assert.equal(result.source, "amll-ttml");
    assert.ok(Array.isArray(result.lyrics));
    assert.ok(result.lyrics.length > 5);
  });
});
