import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SyncedLyricsPayload } from "@repo/types";
import {
  evaluateLyricsCandidate,
  evaluateLyricsCandidates,
  lyricsOverrunToleranceMs,
  type ResolvedLyricsResult,
} from "../src/engine.js";

// One line every 10 seconds from 10s, the last starting at lastStartMs
function lineLyrics(
  lastStartMs: number,
  lastLengthMs = 3000,
): ResolvedLyricsResult {
  const lyrics: SyncedLyricsPayload = [];
  for (let start = 10000; start < lastStartMs; start += 10000) {
    lyrics.push([[1, start, 3000, "line "]]);
  }
  lyrics.push([[1, lastStartMs, lastLengthMs, "last "]]);
  return { lyrics, lyricsType: "line", source: "test", provider: "lrclib" };
}

const TRACK_MS = 200000; // tolerance: 10s

describe("lyrics longer than the track", () => {
  it("allows 5% of the track, but at least 4 seconds", () => {
    assert.equal(lyricsOverrunToleranceMs(200000), 10000);
    assert.equal(lyricsOverrunToleranceMs(60000), 4000);
  });

  it("accepts lyrics that end with the track", () => {
    const evaluation = evaluateLyricsCandidate(lineLyrics(195000), TRACK_MS);
    assert.equal(evaluation.overrunsTrack, false);
    assert.equal(evaluation.isComplete, true);
  });

  it("accepts a last line starting just inside the tolerance", () => {
    const evaluation = evaluateLyricsCandidate(lineLyrics(209000), TRACK_MS);
    assert.equal(evaluation.overrunsTrack, false);
  });

  it("ignores a stretched final word", () => {
    const evaluation = evaluateLyricsCandidate(
      lineLyrics(195000, 60000),
      TRACK_MS,
    );
    assert.equal(evaluation.overrunsTrack, false);
  });

  it("flags lyrics timed for a longer version as incomplete", () => {
    const evaluation = evaluateLyricsCandidate(lineLyrics(320000), TRACK_MS);
    assert.equal(evaluation.overrunsTrack, true);
    assert.equal(evaluation.isComplete, false);
  });

  it("ignores empty tokens after the last sung word", () => {
    const candidate = lineLyrics(195000);
    (candidate.lyrics as SyncedLyricsPayload).push([[1, 400000, 0, " "]]);
    assert.equal(
      evaluateLyricsCandidate(candidate, TRACK_MS).overrunsTrack,
      false,
    );
  });

  it("checks short tracks too", () => {
    assert.equal(
      evaluateLyricsCandidate(lineLyrics(50000), 40000).overrunsTrack,
      true,
    );
  });

  it("cannot judge without a track length", () => {
    assert.equal(
      evaluateLyricsCandidate(lineLyrics(320000)).overrunsTrack,
      false,
    );
  });

  it("drops overrunning candidates, even from the last-resort tier", () => {
    const evaluations = evaluateLyricsCandidates(
      [
        { status: "fulfilled", value: lineLyrics(320000) },
        { status: "fulfilled", value: lineLyrics(195000) },
        { status: "fulfilled", value: null },
        { status: "rejected", reason: new Error("down") },
      ],
      TRACK_MS,
    );
    assert.equal(evaluations.length, 1);
    assert.equal(evaluations[0]!.overrunsTrack, false);
  });
});
