import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SyncedLyricsPayload } from "@repo/types";
import {
  editedLyricFlags,
  fromEditableLines,
  lineText,
  moveAnnotation,
  setLineStart,
  setLineText,
  shiftLines,
  toEditableLines,
  tokenizeLyricText,
  validateEditedLyrics,
  type EditableLine,
} from "../src/utils/editor.js";

const payload: SyncedLyricsPayload = [
  [[1, 1000, 400, "Never "], [1, 1400, 400, "gonna "], [1, 1800, 600, "give "], "T1", "R1"],
  [[2, 3000, 500, "(oh) "]],
  [[3, 4000, 1000, "Whole line as one token "], "", "R3"],
];

function line(text: string, start: number, end: number): EditableLine {
  return {
    words: [{ start, length: end - start, text }],
    bg: false,
    duet: false,
    translation: "",
    romaji: "",
  };
}

describe("editable lines", () => {
  it("round-trips a payload, keeping vocal types and annotations", () => {
    const lines = toEditableLines(payload);
    assert.equal(lines[1]!.bg, true);
    assert.equal(lines[2]!.duet, true);
    assert.equal(lines[0]!.translation, "T1");
    assert.equal(lines[2]!.romaji, "R3");
    assert.deepEqual(fromEditableLines(lines), payload);
  });

  it("rounds fractional and negative times so the result validates", () => {
    const loaded = fromEditableLines(
      toEditableLines([[[1, 4349.999999999999, 120.4, "Hi "], [1, -3, 10, "x "]]]),
    );
    assert.deepEqual(loaded[0]!.slice(0, 2), [
      [1, 4350, 120, "Hi "],
      [1, 0, 10, "x "],
    ]);
    assert.equal(validateEditedLyrics(loaded), null);
  });

  it("keeps an empty translation slot when only romaji is set", () => {
    const [first] = toEditableLines(payload);
    const out = fromEditableLines([{ ...first!, translation: "" }]);
    assert.deepEqual(out[0]!.slice(-2), ["", "R1"]);
  });

  it("flips vocal types with the duet flag", () => {
    const lines = toEditableLines(payload).map((l) => ({ ...l, duet: !l.duet }));
    const out = fromEditableLines(lines);
    assert.equal((out[0]![0] as unknown[])[0], 3);
    assert.equal((out[1]![0] as unknown[])[0], 4);
    assert.equal((out[2]![0] as unknown[])[0], 1);
  });
});

describe("timing edits", () => {
  it("moves every word of a line with its start time", () => {
    const [first] = toEditableLines(payload);
    const moved = setLineStart(first!, 1500);
    assert.deepEqual(
      moved.words.map((w) => w.start),
      [1500, 1900, 2300],
    );
  });

  it("shifts all lines by an offset without going below zero", () => {
    const shifted = shiftLines(toEditableLines(payload), -2000);
    assert.equal(shifted[0]!.words[0]!.start, 0);
    assert.equal(shifted[1]!.words[0]!.start, 1000);
  });
});

describe("text edits", () => {
  it("keeps word timings when the word count is unchanged", () => {
    const [first] = toEditableLines(payload);
    const edited = setLineText(first!, "Never gonna live");
    assert.equal(lineText(edited), "Never gonna live");
    assert.deepEqual(
      edited.words.map((w) => [w.start, w.length]),
      [[1000, 400], [1400, 400], [1800, 600]],
    );
  });

  it("spreads the line's time over a different number of words", () => {
    const [first] = toEditableLines(payload);
    const edited = setLineText(first!, "Never ever gonna give");
    assert.equal(edited.words.length, 4);
    assert.equal(edited.words[0]!.start, 1000);
    const last = edited.words[3]!;
    assert.equal(last.start + last.length, 2400);
  });

  it("keeps a line-synced line as a single token", () => {
    const edited = setLineText(line("Hello there world ", 0, 3000), "Hello again world");
    assert.equal(edited.words.length, 1);
    assert.equal(edited.words[0]!.text, "Hello again world ");
    assert.equal(edited.words[0]!.length, 3000);
  });

  it("keeps syllables of unchanged words, and gives a changed word its old span", () => {
    const [syllables] = toEditableLines([
      [[1, 1000, 400, "Every"], [1, 1400, 400, "body "], [1, 1800, 600, "come "]],
    ]);
    const edited = setLineText(syllables!, "Everybody go");
    assert.deepEqual(
      edited.words.map((w) => [w.start, w.length, w.text]),
      [
        [1000, 400, "Every"],
        [1400, 400, "body "],
        [1800, 600, "go "],
      ],
    );
  });

  it("keeps per-character timing when a CJK line keeps its length", () => {
    const [cjk] = toEditableLines([
      [[1, 0, 300, "君"], [1, 300, 300, "の"], [1, 600, 400, "名"]],
    ]);
    const edited = setLineText(cjk!, "君が名");
    assert.deepEqual(
      edited.words.map((w) => [w.start, w.text]),
      [[0, "君"], [300, "が"], [600, "名"]],
    );
  });

  it("never splits a line on line-synced lyrics", () => {
    const edited = setLineText(line("Hello ", 0, 3000), "Hello there world", {
      lineSynced: true,
    });
    assert.equal(edited.words.length, 1);
    assert.equal(edited.words[0]!.text, "Hello there world ");
  });

  it("times Chinese and Japanese per character", () => {
    assert.deepEqual(tokenizeLyricText("君の名は OK"), ["君", "の", "名", "は ", "OK"]);
  });
});

describe("moving translations", () => {
  const lines = ["a", "b", "c", "d"].map((t, i) => ({
    ...line(`${t} `, i * 1000, i * 1000 + 500),
    translation: `t${t}`,
  }));

  it("shifts the ones in between", () => {
    const moved = moveAnnotation(lines, "translation", 3, 1);
    assert.deepEqual(
      moved.map((l) => l.translation),
      ["ta", "td", "tb", "tc"],
    );
  });

  it("ignores moves outside the list", () => {
    assert.equal(moveAnnotation(lines, "translation", 0, 9), lines);
  });
});

describe("validation", () => {
  it("accepts a normal payload", () => {
    assert.equal(validateEditedLyrics(payload), null);
    assert.deepEqual(editedLyricFlags(payload), {
      hasTranslation: true,
      hasRomaji: true,
    });
  });

  it("rejects empty lyrics", () => {
    assert.match(validateEditedLyrics([])!, /empty/);
    assert.match(validateEditedLyrics([[[1, 0, 100, "  "]]])!, /empty/);
  });

  it("rejects bad words, times and shapes", () => {
    assert.ok(validateEditedLyrics([[[5, 0, 100, "x"]]]));
    assert.ok(validateEditedLyrics([[[1, -1, 100, "x"]]]));
    assert.ok(validateEditedLyrics([[[1, 0.5, 100, "x"]]]));
    assert.ok(validateEditedLyrics([["translation first", [1, 0, 100, "x"]]]));
    assert.ok(validateEditedLyrics([[[1, 0, 100, "x"], "a", "b", "c"]]));
    assert.ok(validateEditedLyrics("not a list"));
  });
});
