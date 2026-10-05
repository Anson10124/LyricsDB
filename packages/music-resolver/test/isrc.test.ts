import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { MusicResolver } from "../src/resolver.js";
import type {
  ResolveOptions,
  ResolvedLink,
  TrackMetadata,
} from "../src/types.js";
import { HttpClient, HttpError, type HttpOptions } from "../src/utils/http.js";
import { backfillIsrc } from "../src/utils/isrc.js";

const metadata = (): TrackMetadata => ({
  id: "spotify-id",
  title: "Smalltown Boy",
  artist: "Bronski Beat",
  type: "song",
});
const link = (
  platform: string,
  id: string,
  isVerified = true,
): ResolvedLink => ({
  platform,
  id,
  url: `https://example.com/${id}`,
  isVerified,
});
const isrc = "GBUM71029604";

describe("ISRC backfill", () => {
  afterEach(() => mock.restoreAll());

  it("resolves a Spotify request with a Deezer detail ISRC before returning metadata", async () => {
    const requests: string[] = [];
    mock.method(HttpClient, "get", async (url: string) => {
      requests.push(url);
      if (url === "https://api.deezer.com/track/428690122")
        return { id: 428690122, isrc: ` ${isrc.toLowerCase()} ` };
      return { message: { header: { status_code: 404 } } };
    });
    const resolver = new MusicResolver({
      musixmatch: { getToken: async () => "token" },
    });
    resolver.registerParser({
      id: "spotify",
      name: "Spotify",
      match: () => true,
      parse: () => ({ id: "spotify-id", type: "song" }),
      fetchMetadata: async () => metadata(),
      buildSearchQuery: () => "Smalltown Boy Bronski Beat",
    });
    resolver.registerAdapter({
      id: "deezer",
      name: "Deezer",
      search: async () => link("deezer", "428690122"),
    });
    const events: Parameters<NonNullable<ResolveOptions["onProgress"]>>[0][] =
      [];
    const result = await resolver.resolve(
      "https://open.spotify.com/track/spotify-id",
      ["deezer"],
      { onProgress: (event) => events.push(event) },
    );
    assert.equal(result.metadata.isrc, isrc);
    assert.ok(requests.includes("https://api.deezer.com/track/428690122"));
    assert.ok(
      events.some(
        (event) => event.step === "enriched_isrc" && event.data?.isrc === isrc,
      ),
    );
  });

  it("uses verified candidate ISRCs without a detail request", async () => {
    const get = mock.method(HttpClient, "get", async () => {
      throw new Error("unexpected request");
    });
    const meta = metadata();
    await backfillIsrc(meta, {
      appleMusic: { ...link("appleMusic", "1320069110"), raw: { isrc } },
    });
    assert.equal(meta.isrc, isrc);
    assert.equal(get.mock.callCount(), 0);
  });

  it("falls back to Apple catalog and refreshes an expired token", async () => {
    const requests: string[] = [];
    const refreshes: boolean[] = [];
    mock.method(
      HttpClient,
      "get",
      async (url: string, options?: HttpOptions) => {
        requests.push(url);
        if (url.includes("deezer")) throw new Error("unavailable");
        if (options?.headers?.Authorization === "Bearer old")
          throw new HttpError("expired", 401, "Unauthorized", url);
        return { data: [{ id: "1320069110", attributes: { isrc } }] };
      },
    );
    const meta = metadata();
    await backfillIsrc(
      meta,
      {
        deezer: link("deezer", "428690122"),
        appleMusic: link("appleMusic", "1320069110"),
      },
      {
        appleMusic: {
          country: "gb",
          getToken: async (_options, refresh = false) => {
            refreshes.push(refresh);
            return refresh ? "new" : "old";
          },
        },
      },
    );
    assert.equal(meta.isrc, isrc);
    assert.deepEqual(refreshes, [false, true]);
    assert.equal(
      requests[1],
      "https://amp-api.music.apple.com/v1/catalog/gb/songs/1320069110",
    );
  });

  it("preserves existing codes and ignores unverified matches and non-songs", async () => {
    const get = mock.method(HttpClient, "get", async () => {
      throw new Error("unexpected request");
    });
    const existing = { ...metadata(), isrc };
    await backfillIsrc(existing, { deezer: link("deezer", "123") });
    assert.equal(existing.isrc, isrc);
    const missing = metadata();
    await backfillIsrc(missing, {
      deezer: { ...link("deezer", "123", false), raw: { isrc } },
    });
    assert.equal(missing.isrc, undefined);
    await backfillIsrc(
      { ...metadata(), type: "album" },
      { deezer: link("deezer", "123") },
    );
    assert.equal(get.mock.callCount(), 0);
  });

  it("ignores invalid codes, mismatched IDs, and provider errors", async () => {
    mock.method(HttpClient, "get", async () => ({ id: 999, isrc }));
    const meta = metadata();
    await backfillIsrc(meta, {
      deezer: { ...link("deezer", "123"), raw: { isrc: "invalid" } },
    });
    assert.equal(meta.isrc, undefined);
    mock.method(HttpClient, "get", async () => ({
      id: 123,
      isrc,
      error: { code: 800 },
    }));
    await backfillIsrc(meta, { deezer: link("deezer", "123") });
    assert.equal(meta.isrc, undefined);
  });
});
