import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchLrcRedTtml } from "../src/fetchers/lrc-red.js";
import { hasWordTiming } from "../src/engine.js";
import { parseTtml } from "../src/parsers/ttml.js";
import { formatLyricsPayload } from "../src/utils/converter.js";

describe("lrc.red word-synced lyrics", () => {
  it("requests only the TTML endpoint using a normalized ISRC", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response("<tt></tt>", { status: 200 });
    };

    try {
      const result = await fetchLrcRedTtml(" gbum71029604 ");
      assert.equal(requestedUrl, "https://lrc.red/s/GBUM71029604.ttml");
      assert.equal(result, "<tt></tt>");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores invalid ISRCs and unavailable or non-TTML responses", async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response("[00:01.00]line lyrics", { status: 200 });
    };

    try {
      assert.equal(await fetchLrcRedTtml("not-an-isrc"), null);
      assert.equal(requests, 0);
      assert.equal(await fetchLrcRedTtml("GBUM71029604"), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts word timing and rejects line-only TTML", () => {
    const wordTtml = formatLyricsPayload(
      [
        [[1, 1000, 400, "First "], [1, 1400, 400, "line"]],
        [[1, 3000, 400, "Second "], [1, 3400, 400, "line"]],
      ],
      "ttml",
    ).content as string;
    assert.equal(hasWordTiming(parseTtml(wordTtml)), true);

    const lineTtml = formatLyricsPayload(
      [
        [[1, 1000, 800, "First line"]],
        [[1, 3000, 800, "Second line"]],
      ],
      "ttml",
    ).content as string;
    assert.equal(hasWordTiming(parseTtml(lineTtml)), false);
  });
});
