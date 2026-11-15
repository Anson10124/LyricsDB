import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderProtectionManager } from "@repo/music-resolver";
import {
  fetchLrcRedTtml,
  LrcRedBlockedError,
} from "../src/fetchers/lrc-red.js";
import { hasWordTiming } from "../src/engine.js";
import { parseTtml } from "../src/parsers/ttml.js";
import { formatLyricsPayload } from "../src/utils/converter.js";

describe("lrc.red word-synced lyrics", () => {
  it("requests only the TTML endpoint using a normalized ISRC", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let userAgent: string | null = null;
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      userAgent = new Headers(init?.headers).get("User-Agent");
      return new Response("<tt></tt>", { status: 200 });
    };

    try {
      const result = await fetchLrcRedTtml(" gbum71029604 ");
      assert.equal(requestedUrl, "https://lrc.red/s/GBUM71029604.ttml");
      assert.equal(result, "<tt></tt>");
      // lrc.red blocks Node's default "node" User-Agent.
      assert.match(userAgent ?? "", /^LyricsDB\//);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws on 403 and 429 so the limiter backs off, but not on 404", async () => {
    const originalFetch = globalThis.fetch;
    let status = 403;
    globalThis.fetch = async () =>
      new Response("blocked", {
        status,
        headers: status === 429 ? { "Retry-After": "120" } : {},
      });

    try {
      await assert.rejects(fetchLrcRedTtml("GBUM71029604"), (error) => {
        assert.ok(error instanceof LrcRedBlockedError);
        // No status: the limiter would otherwise count a 4xx as healthy.
        assert.equal(error.status, undefined);
        return true;
      });

      status = 429;
      await assert.rejects(fetchLrcRedTtml("GBUM71029604"), (error) => {
        assert.ok(error instanceof LrcRedBlockedError);
        assert.equal(error.status, 429);
        assert.equal(error.retryAfter, "120");
        return true;
      });

      status = 404;
      assert.equal(await fetchLrcRedTtml("GBUM71029604"), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("a 403 counts as a limiter failure, a 404 as a healthy answer", async () => {
    const limiter = new ProviderProtectionManager();
    const metrics = () =>
      limiter.getAllMetrics().find((m) => m.provider === "lrcred")!;
    const originalFetch = globalThis.fetch;
    let status = 404;
    globalThis.fetch = async () => new Response("", { status });

    try {
      await limiter.schedule("lrcred", () => fetchLrcRedTtml("GBUM71029604"));
      assert.equal(metrics().totalFailures, 0);

      status = 403;
      await assert.rejects(
        limiter.schedule("lrcred", () => fetchLrcRedTtml("GBUM71029604")),
      );
      assert.equal(metrics().totalFailures, 1);
      assert.match(metrics().lastError ?? "", /403/);
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
