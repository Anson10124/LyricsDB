import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SyncedLyricsPayload } from "@repo/types";
import {
  fixExplicitText,
  fixExplicitLyrics,
  isMaskedToken,
  containsMaskedTokens,
  matchProfanityByShape,
  alignAndUnmaskLyrics,
  optimizeLyricsPayload,
} from "../src/index.js";

describe("Explicit & Masking Detection", () => {
  it("should correctly identify masked tokens", () => {
    assert.equal(isMaskedToken("*****"), true);
    assert.equal(isMaskedToken("****"), true);
    assert.equal(isMaskedToken("b****"), true);
    assert.equal(isMaskedToken("b*tch"), true);
    assert.equal(isMaskedToken("f***ing"), true);
    assert.equal(isMaskedToken("motherf***er"), true);
    assert.equal(isMaskedToken("[censored]"), true);
    assert.equal(isMaskedToken("###"), true);
    assert.equal(isMaskedToken("$$$$"), true);
    assert.equal(isMaskedToken("f#@k"), true);
    assert.equal(isMaskedToken("Britney"), false);
    assert.equal(isMaskedToken("dance"), false);
    assert.equal(isMaskedToken("you"), false);
  });

  it("should detect if payload contains masked tokens", () => {
    const cleanPayload: SyncedLyricsPayload = [
      [
        [1, 1000, 500, "Hello "],
        [1, 1500, 500, "world "],
      ],
    ];
    const maskedPayload: SyncedLyricsPayload = [
      [
        [1, 931, 400, "It's "],
        [1, 1331, 500, "Britney "],
        [1, 1831, 600, "***** "],
      ],
    ];

    assert.equal(containsMaskedTokens(cleanPayload), false);
    assert.equal(containsMaskedTokens(maskedPayload), true);
    assert.equal(containsMaskedTokens("It's Britney *****"), true);
    assert.equal(containsMaskedTokens("It's Britney bitch"), false);
  });

  it("should match profanity by shape dictionary", () => {
    assert.equal(matchProfanityByShape("b***h"), "bitch");
    assert.equal(matchProfanityByShape("m****rf****r"), "motherfucker");
    assert.equal(matchProfanityByShape("f***in"), "fuckin");
    assert.equal(matchProfanityByShape("a******"), "asshole");
    assert.equal(matchProfanityByShape("s**t"), "shit");
    assert.equal(matchProfanityByShape("d**k"), "dick");
  });

  it("should fix common contextual explicit phrases standalone", () => {
    assert.equal(fixExplicitText("It's Britney *****"), "It's Britney bitch");
    assert.equal(fixExplicitText("Son of a *****"), "Son of a bitch");
    assert.equal(fixExplicitText("What the *****"), "What the fuck");
    assert.equal(fixExplicitText("Shut the ***** up"), "Shut the fuck up");
    assert.equal(fixExplicitText("Don't give a *****"), "Don't give a fuck");
    assert.equal(fixExplicitText("Holy *****"), "Holy shit");
    assert.equal(fixExplicitText("b*tch"), "bitch");
    assert.equal(fixExplicitText("f***ing"), "fucking");
  });
});

describe("Cross-Candidate Lyrics Matching & Unmasking", () => {
  it("should unmask 'It's Britney *****' to 'It's Britney bitch' with exact word-level timing preserved", () => {
    // Word-by-word synced target with censored token
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 931, 400, "It's "],
        [1, 1331, 500, "Britney "],
        [1, 1831, 600, "***** "],
      ],
      [
        [1, 7836, 300, "I "],
        [1, 8136, 400, "see "],
        [1, 8536, 300, "you "],
      ],
      [
        [1, 10995, 200, "And "],
        [1, 11195, 200, "I "],
        [1, 11395, 300, "just "],
        [1, 11695, 300, "wanna "],
        [1, 11995, 400, "dance "],
        [1, 12395, 200, "with "],
        [1, 12595, 300, "you "],
      ],
    ];

    // Reference from another provider (e.g. Musixmatch/LRCLIB plain or synced)
    const referenceLyrics = `[00:00.95]It's Britney bitch
[00:07.83]I see you
[00:10.99]And I just wanna dance with you`;

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      targetPayload,
      [referenceLyrics],
    );

    assert.equal(unmaskedCount, 1);
    const unmasked = lyrics as SyncedLyricsPayload;

    // Line 1: Check all 3 word tokens
    assert.equal(unmasked[0]![0]![3], "It's ");
    assert.equal(unmasked[0]![1]![3], "Britney ");
    assert.equal(unmasked[0]![2]![3], "bitch ");

    // Verify timing and vocalType on unmasked token are perfectly preserved!
    assert.equal(unmasked[0]![2]![0], 1); // vocalType
    assert.equal(unmasked[0]![2]![1], 1831); // startMs
    assert.equal(unmasked[0]![2]![2], 600); // lengthMs
  });

  it("should preserve vocal roles (duet / background) when unmasking", () => {
    const duetPayload: SyncedLyricsPayload = [
      [
        [3, 5000, 400, "Bloodsucker, "],
        [3, 5400, 400, "fame "],
        [3, 5800, 600, "f****r "],
      ],
      [
        [4, 7000, 300, "(Bleedin' "],
        [4, 7300, 300, "me "],
        [4, 7600, 400, "dry) "],
      ],
    ];

    const reference = "Bloodsucker, fame fucker\n(Bleedin' me dry)";

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      duetPayload,
      [reference],
    );

    assert.equal(unmaskedCount, 1);
    const unmasked = lyrics as SyncedLyricsPayload;

    assert.equal(unmasked[0]![2]![0], 3); // vocalType preserved as Secondary Lead
    assert.equal(unmasked[0]![2]![1], 5800);
    assert.equal(unmasked[0]![2]![2], 600);
    assert.equal(unmasked[0]![2]![3], "fucker ");
    assert.equal(unmasked[1]![0]![0], 4); // vocalType preserved as Secondary Background
  });

  it("should preserve punctuation and quotes during unmasking", () => {
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 1000, 300, "She "],
        [1, 1300, 200, "a "],
        [1, 1500, 300, "bad "],
        [1, 1800, 500, "\"*****!\" "],
      ],
    ];

    const referencePlain = "She a bad bitch!";

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      targetPayload,
      [referencePlain],
    );

    assert.equal(unmaskedCount, 1);
    const unmasked = lyrics as SyncedLyricsPayload;
    assert.equal(unmasked[0]![3]![3], "\"bitch!\" ");
    assert.equal(unmasked[0]![3]![1], 1800);
    assert.equal(unmasked[0]![3]![2], 500);
  });

  it("should preserve uppercase casing when line is ALL-CAPS", () => {
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 931, 400, "IT'S "],
        [1, 1331, 500, "BRITNEY "],
        [1, 1831, 600, "***** "],
      ],
    ];

    const referencePlain = "it's britney bitch";

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      targetPayload,
      [referencePlain],
    );

    assert.equal(unmaskedCount, 1);
    const unmasked = lyrics as SyncedLyricsPayload;
    assert.equal(unmasked[0]![2]![3], "BITCH ");
  });

  it("should match multiple explicit words across different lines", () => {
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 1000, 400, "Don't "],
        [1, 1400, 400, "give "],
        [1, 1800, 200, "a "],
        [1, 2000, 500, "**** "],
      ],
      [
        [1, 5000, 300, "Talk "],
        [1, 5300, 500, "**** "],
        [1, 5800, 400, "get "],
        [1, 6200, 400, "hit "],
      ],
      [
        [1, 9000, 300, "Crazy "],
        [1, 9300, 500, "a****** "],
      ],
    ];

    const reference = `Don't give a fuck
Talk shit get hit
Crazy asshole`;

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      targetPayload,
      [reference],
    );

    assert.equal(unmaskedCount, 3);
    const unmasked = lyrics as SyncedLyricsPayload;
    assert.equal(unmasked[0]![3]![3], "fuck ");
    assert.equal(unmasked[1]![1]![3], "shit ");
    assert.equal(unmasked[2]![1]![3], "asshole ");
  });

  it("should handle line break discrepancies via context-window phrase matching", () => {
    // Target has line split across 2 lines
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 1000, 400, "All "],
        [1, 1400, 400, "my "],
        [1, 1800, 500, "***** "],
      ],
      [
        [1, 3000, 400, "in "],
        [1, 3400, 400, "the "],
        [1, 3800, 500, "club "],
      ],
    ];

    // Reference has everything on a single combined line
    const reference = "All my bitches in the club put your hands up";

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      targetPayload,
      [reference],
    );

    assert.equal(unmaskedCount, 1);
    const unmasked = lyrics as SyncedLyricsPayload;
    assert.equal(unmasked[0]![2]![3], "bitches ");
  });

  it("should unmask plain text string lyrics", () => {
    const targetText = `It's Britney *****
I see you
And I just wanna dance with you`;

    const reference = `[00:00.931] It's Britney bitch
[00:07.836] I see you
[00:10.995] And I just wanna dance with you`;

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      targetText,
      [reference],
    );

    assert.equal(unmaskedCount, 1);
    assert.equal(
      lyrics,
      `It's Britney bitch
I see you
And I just wanna dance with you`,
    );
  });

  it("should work seamlessly inside optimizeLyricsPayload", () => {
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 931, 400, "It's "],
        [1, 1331, 500, "Britney "],
        [1, 1831, 600, "***** "],
      ],
    ];

    const reference = "It's Britney bitch";

    const optimized = optimizeLyricsPayload(
      targetPayload,
      { title: "Gimme More", artist: "Britney Spears" },
      [reference],
    );

    assert.equal(optimized[0]![2]![3], "bitch ");
    assert.equal(optimized[0]![2]![1], 1831);
    assert.equal(optimized[0]![2]![2], 600);
  });

  it("should preserve trailing space so complete words do not merge (e.g. 'fuck with' not 'fuckwith')", () => {
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 88560, 60, "I "],
        [1, 88620, 360, "****"],
        [1, 88980, 180, "with "],
      ],
    ];

    const reference = "I fuck with the fun again";

    const { lyrics, unmaskedCount } = alignAndUnmaskLyrics(
      targetPayload,
      [reference],
    );

    assert.equal(unmaskedCount, 1);
    const unmasked = lyrics as SyncedLyricsPayload;
    assert.equal(unmasked[0]![0]![3], "I ");
    assert.equal(unmasked[0]![1]![3], "fuck ");
    assert.equal(unmasked[0]![2]![3], "with ");
  });

  it("should ensure trailing space in fixExplicitLyrics when word lacks space", () => {
    const targetPayload: SyncedLyricsPayload = [
      [
        [1, 88560, 60, "I "],
        [1, 88620, 360, "fuck"],
        [1, 88980, 180, "with "],
      ],
    ];

    const fixed = fixExplicitLyrics(targetPayload);
    assert.equal(fixed[0]![0]![3], "I ");
    assert.equal(fixed[0]![1]![3], "fuck ");
    assert.equal(fixed[0]![2]![3], "with ");
  });
});

