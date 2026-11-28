import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseShazamResponse,
  type ShazamTagResponse,
} from "../src/adapters/shazam-audio-match.js";
import { detectProviderFromUrl } from "../src/utils/http.js";

// A real answer for 4 s of "All At Once" cut at 0:30, trimmed to the fields
// the parser reads
const HIT: ShazamTagResponse = {
  matches: [
    {
      id: "822309103",
      offset: 29.999541015,
      timeskew: 0.00021231174,
      frequencyskew: -0.00004029274,
    },
  ],
  track: {
    key: "822309103",
    title: "All At Once",
    subtitle: "Madison Beer",
    isrc: "USAT22503087",
    hub: {
      actions: [
        { type: "applemusicplay", id: "1821963553" },
        { type: "uri" },
      ],
    },
    sections: [
      {
        type: "SONG",
        metadata: [
          { title: "Album", text: "F1 The Album (Cinematic Edition)" },
          { title: "Label", text: "Atlantic Records" },
          { title: "Released", text: "2025" },
        ],
      },
    ],
  },
};

// A real answer for 4 s of pink noise
const MISS: ShazamTagResponse = { matches: [], retryms: 5000 };

describe("parseShazamResponse", () => {
  it("reads the song, its IDs and where the clip starts", () => {
    assert.deepEqual(parseShazamResponse(HIT), {
      match: {
        shazamKey: "822309103",
        title: "All At Once",
        artist: "Madison Beer",
        album: "F1 The Album (Cinematic Edition)",
        isrc: "USAT22503087",
        appleMusicId: "1821963553",
        offsetMs: 30000,
      },
      retryMs: null,
    });
  });

  it("returns no match, with Shazam's wait, when nothing was heard", () => {
    assert.deepEqual(parseShazamResponse(MISS), { match: null, retryMs: 5000 });
  });

  it("rejects a match with a large skew", () => {
    const skewed = { ...HIT, matches: [{ ...HIT.matches![0]!, timeskew: 0.02 }] };
    assert.equal(parseShazamResponse(skewed).match, null);
  });

  it("copes with a track missing optional fields", () => {
    const { match } = parseShazamResponse({
      matches: [{ offset: 1.5 }],
      track: { key: "1", title: "Song" },
    });
    assert.deepEqual(match, {
      shazamKey: "1",
      title: "Song",
      artist: "",
      album: null,
      isrc: null,
      appleMusicId: null,
      offsetMs: 1500,
    });
  });

  it("throws on a non-JSON answer such as the 429 page", () => {
    assert.throws(() =>
      parseShazamResponse("<title>429</title>" as unknown as ShazamTagResponse),
    );
  });
});

describe("Shazam provider", () => {
  it("is rate limited as its own provider", () => {
    assert.equal(detectProviderFromUrl("https://amp.shazam.com/discovery/v5/x"), "shazam");
  });
});
