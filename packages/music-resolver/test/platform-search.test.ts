import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DeezerAdapter } from "../src/adapters/deezer.js";
import { MusicResolver } from "../src/resolver.js";
import {
  globalProviderLimiter,
  ProviderProtectionManager,
  ProviderRateLimitedError,
} from "../src/utils/provider-limiter.js";
import { rankMatches } from "../src/utils/string-similarity.js";
import type { MatchCandidate, TrackMetadata } from "../src/types.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  globalProviderLimiter.resetAll();
});

const target: TrackMetadata = {
  id: "t",
  type: "song",
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  durationMs: 213_000,
};

const deezerTrack = (id: number, title: string, extra: object = {}) => ({
  id,
  title,
  link: `https://www.deezer.com/track/${id}`,
  duration: 213,
  artist: { id: 1, name: "Rick Astley" },
  album: { id: 2, title: "Whenever You Need Somebody", cover_medium: "https://e-cdns-images.dzcdn.net/c.jpg" },
  ...extra,
});

// Answers Deezer requests by path; records every URL asked for
function mockDeezer(routes: Record<string, () => Response>) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    const route = Object.keys(routes).find((path) => url.includes(path));
    if (!route) return new Response("not mocked", { status: 500 });
    return routes[route]!();
  }) as typeof fetch;
  return urls;
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("rankMatches", () => {
  it("orders by score and keeps one entry per ID", () => {
    const candidates: MatchCandidate[] = [
      { id: "a", url: "u/a", title: "Something Else", artist: "Nobody" },
      { id: "b", url: "u/b", title: "Never Gonna Give You Up", artist: "Rick Astley", durationMs: 213_000 },
      { id: "b", url: "u/b", title: "Never Gonna Give You Up (Live)", artist: "Rick Astley" },
    ];
    const ranked = rankMatches(candidates, target);
    assert.deepEqual(ranked.map((r) => r.candidate.id), ["b", "a"]);
    assert.equal(ranked[0]!.candidate.title, "Never Gonna Give You Up");
    assert.equal(ranked[0]!.isVerified, true);
  });

  it("stops at the limit", () => {
    const candidates = ["a", "b", "c"].map((id) => ({ id, url: id, title: id }));
    assert.equal(rankMatches(candidates, target, 2).length, 2);
  });
});

describe("adapter searchCandidates", () => {
  it("puts the ISRC hit first and still returns the keyword results", async () => {
    mockDeezer({
      "/track/isrc:": () => json(deezerTrack(1, "Never Gonna Give You Up", { isrc: "GBARL9300135" })),
      "/search/track": () => json({ data: [deezerTrack(2, "Never Gonna Give You Up (Remastered)")], total: 1 }),
    });
    const candidates = await new DeezerAdapter().searchCandidates(
      "q",
      { ...target, isrc: "GBARL9300135" },
    );
    assert.deepEqual(candidates.map((c) => c.id), ["1", "2"]);
    assert.equal(candidates[0]!.artworkUrl, "https://e-cdns-images.dzcdn.net/c.jpg");
  });

  it("throws when the platform fails, while search() still returns null", async () => {
    mockDeezer({ "/search/track": () => new Response("down", { status: 503 }) });
    const adapter = new DeezerAdapter();
    await assert.rejects(adapter.searchCandidates("q", target, { retries: 0 }));
    assert.equal(await adapter.search("q", target, { retries: 0 }), null);
  });

  it("search() keeps returning the ISRC hit without a keyword request", async () => {
    const urls = mockDeezer({
      "/track/isrc:": () => json(deezerTrack(1, "Never Gonna Give You Up", { isrc: "GBARL9300135" })),
    });
    const link = await new DeezerAdapter().search("q", { ...target, isrc: "GBARL9300135" });
    assert.equal(link?.matchReason, "isrc");
    assert.equal(link?.matched, undefined);
    assert.ok(urls.every((url) => !url.includes("/search/")));
  });
});

describe("MusicResolver.searchPlatform", () => {
  it("returns ranked matches for the platform", async () => {
    mockDeezer({
      "/search/track": () =>
        json({
          data: [deezerTrack(3, "Other Song", { duration: 100 }), deezerTrack(4, "Never Gonna Give You Up")],
          total: 2,
        }),
    });
    const results = await new MusicResolver().searchPlatform("deezer", target);
    assert.equal(results[0]!.candidate.id, "4");
    assert.equal(results[0]!.isVerified, true);
  });

  it("fails fast while the provider is cooling down", async () => {
    const urls = mockDeezer({});
    globalProviderLimiter.triggerCooldown("deezer", 60, "test");
    await assert.rejects(
      new MusicResolver().searchPlatform("deezer", target),
      (err: unknown) => err instanceof ProviderRateLimitedError,
    );
    assert.equal(urls.length, 0);
  });

  it("rejects a platform that can't be searched", async () => {
    await assert.rejects(new MusicResolver().searchPlatform("isrc", target), /can't be searched/);
  });
});

describe("provider queue priority", () => {
  it("runs normal work ahead of queued background work", async () => {
    const manager = new ProviderProtectionManager();
    const limiter = manager.getLimiter("deezer");
    const concurrency = (limiter as unknown as { config: { concurrency: number } }).config.concurrency;

    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Fill every slot so the next tasks wait in the queue
    const blockers = Array.from({ length: concurrency }, () =>
      manager.schedule("deezer", () => gate),
    );
    const background = manager.schedule("deezer", async () => void order.push("background"), -1);
    const normal = manager.schedule("deezer", async () => void order.push("normal"));

    release();
    await Promise.all([...blockers, background, normal]);
    assert.deepEqual(order, ["normal", "background"]);
    manager.resetAll();
  });
});
