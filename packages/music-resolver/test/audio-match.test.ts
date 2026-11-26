import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAudioMatchResponse,
  type NeteaseAudioMatchResponse,
} from "../src/adapters/netease-audio-match.js";
import {
  groupAudioMatches,
  isCoverUpload,
  stripCoverMarkers,
} from "../src/utils/audio-match-rank.js";

// A real answer for 3 s of "I Really Want to Stay at Your House" (the Rosa
// Walton original, 4:06), trimmed to the fields the parser reads. NetEase heard
// an AI cover and a Cantonese version that share the original's audio, and a
// longer edit that puts the clip somewhere else entirely.
const REAL_RESPONSE: NeteaseAudioMatchResponse = {
  code: 200,
  data: {
    queryId: "test",
    noMatchReason: 0,
    result: [
      {
        startTime: 51880,
        song: {
          id: 3445819726,
          name: "【AI Lucy cover】I Really Want to Stay at Your House",
          artists: [{ name: "DoroP_" }],
          album: { name: "" },
          duration: 246698,
        },
      },
      {
        startTime: 119560,
        song: {
          id: 2082259634,
          name: "I Really Want to Stay at Your House",
          artists: [{ name: "Gökhan Can" }],
          album: { name: "I Really Want to Stay at Your House" },
          duration: 261758,
        },
      },
      {
        startTime: 51860,
        song: {
          id: 1986277975,
          name: "I Really Want to Stay At Your House",
          artists: [{ name: "三本目" }, { name: "邝梓玮Sylvia" }],
          album: { name: "一首广东歌（三本目粤语填词作品集）" },
          duration: 246480,
        },
      },
    ],
  },
};

describe("parseAudioMatchResponse", () => {
  it("reads every candidate with its offset", () => {
    const { candidates, noMatchReason } = parseAudioMatchResponse(REAL_RESPONSE);
    assert.equal(noMatchReason, null);
    assert.deepEqual(candidates[0], {
      neteaseId: "3445819726",
      title: "【AI Lucy cover】I Really Want to Stay at Your House",
      artists: ["DoroP_"],
      album: null,
      durationMs: 246698,
      offsetMs: 51880,
    });
    assert.deepEqual(candidates[2]!.artists, ["三本目", "邝梓玮Sylvia"]);
  });

  it("passes on why nothing matched", () => {
    const result = parseAudioMatchResponse({
      code: 200,
      data: { result: null, noMatchReason: 10 },
    });
    assert.deepEqual(result, { candidates: [], noMatchReason: 10 });
  });

  it("fails on an error code", () => {
    assert.throws(() => parseAudioMatchResponse({ code: 400 }), /code 400/);
  });
});

describe("isCoverUpload / stripCoverMarkers", () => {
  it("spots AI covers and tagged versions", () => {
    const base = { neteaseId: "1", artists: [], album: null, durationMs: null, offsetMs: 0 };
    assert.equal(isCoverUpload({ ...base, title: "【AI Lucy cover】Song" }), true);
    assert.equal(isCoverUpload({ ...base, title: "Song (AI)" }), true);
    assert.equal(isCoverUpload({ ...base, title: "Song (翻唱)" }), true);
    assert.equal(isCoverUpload({ ...base, title: "Song (Live)" }), true);
    assert.equal(isCoverUpload({ ...base, title: "Song" }), false);
    assert.equal(isCoverUpload({ ...base, title: "Said (AI) Things" }), true);
    assert.equal(isCoverUpload({ ...base, title: "Song (feat. Aiko)" }), false);
  });

  it("keeps the song's own name", () => {
    assert.equal(
      stripCoverMarkers("【AI Lucy cover】I Really Want to Stay at Your House"),
      "I Really Want to Stay at Your House",
    );
    assert.equal(stripCoverMarkers("Song (Remastered 2011)"), "Song (Remastered 2011)");
  });
});

describe("groupAudioMatches", () => {
  const { candidates } = parseAudioMatchResponse(REAL_RESPONSE);

  it("puts uploads that agree on length and offset together", () => {
    const [best, other] = groupAudioMatches(candidates);
    assert.deepEqual(
      best!.entries.map((c) => c.neteaseId),
      // The plain upload first, the AI cover after it
      ["1986277975", "3445819726"],
    );
    assert.equal(best!.offsetMs, 51870);
    assert.equal(best!.durationMs, 246589);
    assert.equal(best!.cleanTitle, "I Really Want to Stay At Your House");
    assert.deepEqual(other!.entries.map((c) => c.neteaseId), ["2082259634"]);
  });

  it("prefers the group near where the listener already is", () => {
    const [best] = groupAudioMatches(candidates, { expectedOffsetMs: 121_000 });
    assert.deepEqual(best!.entries.map((c) => c.neteaseId), ["2082259634"]);
  });

  it("keeps NetEase's order between groups of the same size", () => {
    const [a, b] = groupAudioMatches([candidates[1]!, candidates[0]!]);
    assert.equal(a!.entries[0]!.neteaseId, "2082259634");
    assert.equal(b!.entries[0]!.neteaseId, "3445819726");
  });

  it("returns nothing for no candidates", () => {
    assert.deepEqual(groupAudioMatches([]), []);
  });
});
