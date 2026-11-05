import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMusixmatchDecoyTrackId,
  isUsableMusixmatchToken,
} from "@repo/music-resolver";
import {
  isMusixmatchDecoyLyrics,
  isPlaceholderLyricText,
  parseMusixmatchRichSync,
  parseMusixmatchSubtitles,
} from "../src/index.js";

const DECOY_LRC = [
  "[00:12.000]Wob gopini den ",
  "[00:16.000]Tefe woxica fero ",
  "[00:20.000]Gogoh vudob wiya ",
  "[00:24.000]Keric sohu peduf ",
].join("\n");

const DECOY_RICHSYNC = JSON.stringify([
  {
    ts: 12,
    te: 15.5,
    l: [
      { c: "Wob", o: 0 },
      { c: " ", o: 0.4 },
      { c: "gopini", o: 0.5 },
      { c: " ", o: 1.1 },
      { c: "den", o: 1.2 },
    ],
    x: "Wob gopini den",
  },
  {
    ts: 16,
    te: 19.5,
    l: [{ c: "Tefe woxica fero", o: 0 }],
    x: "Tefe woxica fero",
  },
]);

const REAL_LRC = [
  "[00:27.49] I've been tryna call",
  "[00:30.26] I've been on my own for long enough",
].join("\n");

describe("Musixmatch decoy lyrics", () => {
  it("detects the decoy in LRC, RichSync and plain text", () => {
    assert.equal(isMusixmatchDecoyLyrics(DECOY_LRC), true);
    assert.equal(isMusixmatchDecoyLyrics(DECOY_RICHSYNC), true);
    assert.equal(
      isMusixmatchDecoyLyrics("Wob gopini den\nTefe woxica fero\n"),
      true,
    );
  });

  it("leaves real lyrics alone", () => {
    assert.equal(isMusixmatchDecoyLyrics(REAL_LRC), false);
    assert.equal(isPlaceholderLyricText(REAL_LRC), false);
    assert.ok(parseMusixmatchSubtitles(REAL_LRC).length > 0);
  });

  it("treats the decoy as placeholder text so parsers drop it", () => {
    assert.equal(isPlaceholderLyricText(DECOY_LRC), true);
    assert.deepEqual(parseMusixmatchSubtitles(DECOY_LRC), []);
    assert.deepEqual(parseMusixmatchRichSync(DECOY_RICHSYNC), []);
  });

  it("recognises the decoy track id", () => {
    assert.equal(isMusixmatchDecoyTrackId(226291677), true);
    assert.equal(isMusixmatchDecoyTrackId("226291677"), true);
    assert.equal(isMusixmatchDecoyTrackId(232858081), false);
    assert.equal(isMusixmatchDecoyTrackId(undefined), false);
  });

  it("rejects the all-zero dummy token", () => {
    assert.equal(isUsableMusixmatchToken("0".repeat(56)), false);
    assert.equal(isUsableMusixmatchToken("Upgrade. Paid script."), false);
    assert.equal(isUsableMusixmatchToken(""), false);
    assert.equal(
      isUsableMusixmatchToken(
        "26110541a45d2b304249f6f6d3cb7475adf17dbeada384484c0319",
      ),
      true,
    );
  });
});
