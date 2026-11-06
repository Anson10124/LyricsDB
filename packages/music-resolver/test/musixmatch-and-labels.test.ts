import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { NeteaseAdapter } from "../src/adapters/netease.js";
import { NeteaseParser } from "../src/parsers/netease.js";
import { QQMusicParser } from "../src/parsers/qq-music.js";
import type { TrackMetadata } from "../src/types.js";
import { HttpClient } from "../src/utils/http.js";
import {
  isTrustedMusixmatchMatch,
  matchTrackWithMusixmatch,
} from "../src/utils/musixmatch-matcher.js";

const getToken = async () => "token";

function musixmatchTrack(track: Record<string, unknown>) {
  return { message: { header: { status_code: 200 }, body: { track } } };
}

describe("Musixmatch matcher", () => {
  afterEach(() => mock.restoreAll());

  it("takes no ISRC or Spotify ID from sibling releases in the commontrack", async () => {
    mock.method(HttpClient, "get", async () =>
      musixmatchTrack({
        track_id: 1,
        track_name: "Song",
        commontrack_isrcs: [["SIBLING00001"]],
        commontrack_spotify_ids: ["siblingSpotify"],
        commontrack_itunes_ids: [123],
        track_length: 200,
      }),
    );

    const result = await matchTrackWithMusixmatch(
      { isrc: "SOURCE000001" },
      { getToken },
    );
    assert.equal(result?.matchedBy, "isrc");
    assert.equal(result?.isrc, undefined);
    assert.equal(result?.spotifyId, undefined);
    assert.equal(result?.appleMusicId, undefined);
    assert.equal(result?.durationMs, 200000);
  });

  it("keeps the exact track's own IDs", async () => {
    mock.method(HttpClient, "get", async () =>
      musixmatchTrack({
        track_id: 1,
        track_name: "Song",
        track_isrc: "OWN000000001",
        track_spotify_id: "ownSpotify",
        commontrack_spotify_ids: ["siblingSpotify", "ownSpotify"],
      }),
    );

    const result = await matchTrackWithMusixmatch(
      { title: "Song", artist: "Artist" },
      { getToken },
    );
    assert.equal(result?.matchedBy, "title");
    assert.equal(result?.isrc, "OWN000000001");
    assert.equal(result?.spotifyId, "ownSpotify");
  });
});

describe("isTrustedMusixmatchMatch", () => {
  const target: TrackMetadata = {
    id: "1",
    title: "Song",
    type: "song",
    durationMs: 200000,
  };

  it("accepts the same recording found by ID", () => {
    assert.equal(
      isTrustedMusixmatchMatch(
        { matchedBy: "spotify", title: "Song - Remastered", durationMs: 202000 },
        target,
      ),
      true,
    );
  });

  it("rejects another version or length", () => {
    assert.equal(
      isTrustedMusixmatchMatch(
        { matchedBy: "spotify", title: "Song (Live)", durationMs: 200000 },
        target,
      ),
      false,
    );
    assert.equal(
      isTrustedMusixmatchMatch(
        { matchedBy: "isrc", title: "Song", album: "Live at Wembley" },
        target,
      ),
      false,
    );
    assert.equal(
      isTrustedMusixmatchMatch(
        { matchedBy: "apple", title: "Song", durationMs: 260000 },
        target,
      ),
      false,
    );
  });

  it("needs both lengths for a title search", () => {
    assert.equal(
      isTrustedMusixmatchMatch({ matchedBy: "title", title: "Song" }, target),
      false,
    );
    assert.equal(
      isTrustedMusixmatchMatch(
        { matchedBy: "title", title: "Song", durationMs: 201000 },
        target,
      ),
      true,
    );
  });
});

describe("NetEase and QQ version labels", () => {
  afterEach(() => mock.restoreAll());

  const neteaseSong = (id: number, alia: string[]) => ({
    id,
    name: "Song",
    ar: [{ id: 1, name: "Artist" }],
    al: { id: 1, name: "Album" },
    dt: 200000,
    alia,
  });

  it("NetEase search reads version labels from alia, not as artists", async () => {
    mock.method(HttpClient, "post", async () => ({
      code: 200,
      result: {
        songs: [neteaseSong(1, ["Live"]), neteaseSong(2, ["电视剧《某剧》主题曲"])],
      },
    }));

    const match = await new NeteaseAdapter().search("Song Artist", {
      id: "x",
      title: "Song",
      artist: "Artist",
      type: "song",
      durationMs: 200000,
    });
    assert.equal(match?.id, "2");
    assert.equal(match?.matched?.title, "Song");
  });

  it("NetEase search titles a live entry as live", async () => {
    mock.method(HttpClient, "post", async () => ({
      code: 200,
      result: { songs: [neteaseSong(1, ["Live"])] },
    }));

    const match = await new NeteaseAdapter().search("Song Artist", {
      id: "x",
      title: "Song",
      artist: "Artist",
      type: "song",
    });
    assert.equal(match?.matched?.title, "Song (Live)");
  });

  it("NetEase parser folds a version label into the title", async () => {
    mock.method(HttpClient, "post", async () => ({
      code: 200,
      songs: [neteaseSong(1, ["伴奏"])],
    }));

    const meta = await new NeteaseParser().fetchMetadata(
      "1",
      "https://music.163.com/#/song?id=1",
    );
    assert.equal(meta.title, "Song (伴奏)");
  });

  it("QQ parser keeps the version that the bare name drops", async () => {
    mock.method(HttpClient, "get", async () => ({
      code: 0,
      data: [
        {
          id: 1,
          mid: "004Fs2FP1EvZYc",
          name: "晴天",
          title: "晴天 (Live)",
          subtitle: "",
          interval: 249,
          singer: [{ id: 1, mid: "a", name: "周杰伦" }],
          album: { id: 1, mid: "b", name: "周杰伦地表最强世界巡回演唱会" },
        },
      ],
    }));

    const meta = await new QQMusicParser().fetchMetadata(
      "004Fs2FP1EvZYc",
      "https://y.qq.com/n/ryqq/songDetail/004Fs2FP1EvZYc",
    );
    assert.equal(meta.title, "晴天 (Live)");
  });
});
