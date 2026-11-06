import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getVersionTags,
  sameVersionTags,
  withVersionLabels,
} from "../src/utils/query.js";

describe("getVersionTags", () => {
  it("reads versions from a title's brackets and dash suffix", () => {
    assert.deepEqual(getVersionTags("Song (Live)"), ["live"]);
    assert.deepEqual(getVersionTags("Song - Live at Wembley"), ["live"]);
    assert.deepEqual(getVersionTags("Song [Acoustic Version]"), ["acoustic"]);
    assert.deepEqual(getVersionTags("Song - DJ Snake Remix"), ["remix"]);
    assert.deepEqual(getVersionTags("Song (Instrumental)"), ["instrumental"]);
    assert.deepEqual(getVersionTags("Song (Sped Up)"), ["sped-up"]);
    assert.deepEqual(getVersionTags("Song (Slowed + Reverb)"), ["slowed"]);
    assert.deepEqual(getVersionTags("Song (Taylor's Version)"), [
      "re-recording",
    ]);
    assert.deepEqual(getVersionTags("Song (Cover)"), ["cover"]);
    assert.deepEqual(getVersionTags("歌（Live）"), ["live"]);
    assert.deepEqual(getVersionTags("歌 (伴奏)"), ["instrumental"]);
    assert.deepEqual(getVersionTags("Song (Live Acoustic)"), [
      "acoustic",
      "live",
    ]);
  });

  it("ignores version words that are part of the song's name", () => {
    assert.deepEqual(getVersionTags("Live Forever"), []);
    assert.deepEqual(getVersionTags("Cover Me"), []);
    assert.deepEqual(getVersionTags("Remix to Ignition"), []);
  });

  it("does not treat remasters, editions or features as another version", () => {
    assert.deepEqual(getVersionTags("Song - Remastered 2011"), []);
    assert.deepEqual(getVersionTags("Song (feat. Someone)"), []);
    assert.deepEqual(getVersionTags("Song", "Album (Deluxe Edition)"), []);
  });

  it("reads only clear version names from albums", () => {
    assert.deepEqual(getVersionTags("Song", "Live at Budokan"), ["live"]);
    assert.deepEqual(getVersionTags("Song", "MTV Unplugged"), ["acoustic"]);
    assert.deepEqual(getVersionTags("Song", "The Remixes"), ["remix"]);
    assert.deepEqual(getVersionTags("Song", "Live Through This"), []);
    assert.deepEqual(getVersionTags("晴天", "周杰伦地表最强世界巡回演唱会"), [
      "live",
    ]);
  });
});

describe("withVersionLabels", () => {
  it("appends only labels that name a version", () => {
    assert.equal(withVersionLabels("Song", ["Live"]), "Song (Live)");
    assert.equal(withVersionLabels("Song", ["电视剧《某剧》主题曲"]), "Song");
    assert.equal(withVersionLabels("Song", [null, "", undefined]), "Song");
    assert.equal(withVersionLabels("Song (Live)", ["Live"]), "Song (Live)");
    assert.equal(
      withVersionLabels("Song (Live at Wembley)", ["Live"]),
      "Song (Live at Wembley)",
    );
    assert.equal(
      withVersionLabels("Live Forever", ["Live"]),
      "Live Forever (Live)",
    );
  });
});

describe("sameVersionTags", () => {
  it("compares tag sets", () => {
    assert.equal(sameVersionTags(["live"], ["live"]), true);
    assert.equal(sameVersionTags([], ["live"]), false);
    assert.equal(sameVersionTags(["acoustic", "live"], ["live"]), false);
  });
});
