import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNeteasePreview, PREVIEW_LENGTH_MS } from "../src/index.js";

const base = {
  id: 2637558926,
  url: "http://m702.music.126.net/a/b.mp3?vuutv=x",
  code: 200,
  expi: 1200,
};

describe("parseNeteasePreview", () => {
  it("uses the whole trial slice of a paid song and switches to https", () => {
    const preview = parseNeteasePreview({
      ...base,
      time: 30040,
      size: 481115,
      freeTrialInfo: { start: 0, end: 30 },
    });
    assert.deepEqual(preview, {
      url: "https://m702.music.126.net/a/b.mp3?vuutv=x",
      startMs: 0,
      endMs: 30040,
      expiresInMs: 1_200_000,
      bytes: 481115,
    });
  });

  it("places a trial that starts mid-song at its offset", () => {
    const preview = parseNeteasePreview({
      ...base,
      time: 45024,
      size: 720813,
      freeTrialInfo: { start: 62, end: 107 },
    });
    assert.equal(preview?.startMs, 62_000);
    assert.equal(preview?.endMs, 107_024);
    assert.equal(preview?.bytes, 720813);
  });

  it("cuts a whole free song down to the opening preview", () => {
    const preview = parseNeteasePreview({
      ...base,
      time: 267232,
      size: 4_276_000,
      freeTrialInfo: null,
    });
    assert.equal(preview?.startMs, 0);
    assert.equal(preview?.endMs, PREVIEW_LENGTH_MS);
    // Only about the first 31 s of the 267 s file is downloaded
    assert.equal(
      preview?.bytes,
      Math.ceil((4_276_000 * (PREVIEW_LENGTH_MS + 1000)) / 267232),
    );
  });

  it("returns null when NetEase gives no audio", () => {
    assert.equal(
      parseNeteasePreview({ ...base, url: null, code: 404, time: 0 }),
      null,
    );
    assert.equal(parseNeteasePreview(undefined), null);
  });
});
