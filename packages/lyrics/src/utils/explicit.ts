import type {
  CompactLyricLine,
  CompactLyricWord,
  SyncedLyricsPayload,
} from "@repo/types";

const EXPLICIT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bmotherf\*+(?:c?k)?ers?\b/gi, "motherfucker"],
  [/\bmotherf\*{3,4}ers?\b/gi, "motherfucker"],
  [/\bmotherf\*+(?:c?k)?(?:ing|in'?)(?![a-zA-Z0-9])/gi, "motherfucking"],
  [/\bmotherf\*{3,4}(?:ing|in'?)(?![a-zA-Z0-9])/gi, "motherfucking"],
  [/\bmotherf\*+(?:c?k)?\b/gi, "motherfuck"],
  [/\bmotherf\*{3,4}(?![a-zA-Z0-9*])/gi, "motherfuck"],

  [/\bbullsh\*+t\b/gi, "bullshit"],
  [/\bbulls\*{2,}t?\b/gi, "bullshit"],
  [/\bbullsh\*{2,}(?![a-zA-Z0-9*])/gi, "bullshit"],

  [/\bf\*+(?:c?k)?(?:ing|in'?)(?![a-zA-Z0-9])/gi, "fucking"],
  [/\bf\*{2,3}(?:ing|in'?)(?![a-zA-Z0-9])/gi, "fucking"],
  [/\bf\*+(?:c?k)?ers?\b/gi, "fucker"],
  [/\bf\*{2,3}ers?\b/gi, "fucker"],
  [/\bf\*+(?:c?k)?ed\b/gi, "fucked"],
  [/\bf\*{2,3}ed\b/gi, "fucked"],
  [/\bf\*+(?:c?k)?s\b/gi, "fucks"],
  [/\bf\*{2,3}s\b/gi, "fucks"],
  [/\bf\*+ck\b/gi, "fuck"],
  [/\bfu\*+k\b/gi, "fuck"],
  [/\bf\*{2}k\b/gi, "fuck"],
  [/\bf\*{3,4}(?![a-zA-Z0-9*])/gi, "fuck"],

  [/\bsh\*+tty\b/gi, "shitty"],
  [/\bs\*{2,}tty\b/gi, "shitty"],
  [/\bsh\*+ts\b/gi, "shits"],
  [/\bs\*{2,}ts\b/gi, "shits"],
  [/\bsh\*+t\b/gi, "shit"],
  [/\bs\*{2}t\b/gi, "shit"],
  [/\bsh\*{2}(?![a-zA-Z0-9*])/gi, "shit"],
  [/\bs\*{3}(?![a-zA-Z0-9*])/gi, "shit"],

  [/\bb\*+tches\b/gi, "bitches"],
  [/\bb\*{2,3}hes\b/gi, "bitches"],
  [/\bb\*{3,}es\b/gi, "bitches"],
  [/\bb\*{5}s\b/gi, "bitches"],
  [/\bb\*+tch\b/gi, "bitch"],
  [/\bb\*{2,3}h\b/gi, "bitch"],
  [/\bb\*{3,4}(?![a-zA-Z0-9*])/gi, "bitch"],

  [/\ba\*+sholes?\b/gi, "asshole"],
  [/\ba\*{2}holes?\b/gi, "asshole"],
  [/\bassh\*+les?\b/gi, "asshole"],
  [/\ba\*+ses\b/gi, "asses"],
  [/\ba\*{2}es\b/gi, "asses"],
  [/\ba\*s\b/gi, "ass"],
  [/\ba\*{2}(?![a-zA-Z0-9*])/gi, "ass"],

  [/\bb\*+stards?\b/gi, "bastard"],
  [/\bb\*{2,}tards?\b/gi, "bastard"],

  [/\bn\*+ggers\b/gi, "niggers"],
  [/\bn\*{2,3}ers\b/gi, "niggers"],
  [/\bn\*+gger\b/gi, "nigger"],
  [/\bn\*{2,3}er\b/gi, "nigger"],
  [/\bn\*+ggas\b/gi, "niggas"],
  [/\bn\*{2,3}as\b/gi, "niggas"],
  [/\bni\*{2}as\b/gi, "niggas"],
  [/\bn\*+gga\b/gi, "nigga"],
  [/\bn\*{2,3}a\b/gi, "nigga"],
  [/\bni\*{2}a\b/gi, "nigga"],
  [/\bn\*{3,4}(?![a-zA-Z0-9*])/gi, "nigga"],

  [/\bp\*+ssies\b/gi, "pussies"],
  [/\bp\*{2,3}ies\b/gi, "pussies"],
  [/\bp\*+ssy\b/gi, "pussy"],
  [/\bp\*{2,3}y\b/gi, "pussy"],
  [/\bp\*{2}sy\b/gi, "pussy"],
  [/\bp\*{3,4}(?![a-zA-Z0-9*])/gi, "pussy"],

  [/\bd\*+cks\b/gi, "dicks"],
  [/\bd\*{2}ks\b/gi, "dicks"],
  [/\bd\*+ck\b/gi, "dick"],
  [/\bd\*{2}k\b/gi, "dick"],

  [/\bc\*+cks\b/gi, "cocks"],
  [/\bc\*{2}ks\b/gi, "cocks"],
  [/\bc\*+ck\b/gi, "cock"],
  [/\bc\*{2}k\b/gi, "cock"],

  [/\bc\*+nts\b/gi, "cunts"],
  [/\bc\*{2}ts\b/gi, "cunts"],
  [/\bc\*+nt\b/gi, "cunt"],
  [/\bc\*{2}t\b/gi, "cunt"],
  [/\bc\*{3}(?![a-zA-Z0-9*])/gi, "cunt"],

  [/\bd\*+mmit\b/gi, "dammit"],
  [/\bd\*{2}mit\b/gi, "dammit"],
  [/\bd\*+mn\b/gi, "damn"],
  [/\bd\*{2}n\b/gi, "damn"],
  [/\bd\*{3}(?![a-zA-Z0-9*])/gi, "damn"],

  [/\bw\*+res\b/gi, "whores"],
  [/\bw\*{3}es\b/gi, "whores"],
  [/\bw\*+re\b/gi, "whore"],
  [/\bw\*{3}e\b/gi, "whore"],
  [/\bw\*{4}(?![a-zA-Z0-9*])/gi, "whore"],

  [/\bh\*+es\b/gi, "hoes"],
  [/\bh\*{2}s\b/gi, "hoes"],
  [/\bh\*e\b/gi, "hoe"],
  [/\bh\*{2}(?![a-zA-Z0-9*])/gi, "hoe"],

  [/\bc\*+caine\b/gi, "cocaine"],
  [/\bc\*{4,5}e\b/gi, "cocaine"],
  [/\bw\*+ed\b/gi, "weed"],
  [/\bw\*{2}d\b/gi, "weed"],
  [/\bd\*+pe\b/gi, "dope"],
  [/\bd\*{2}e\b/gi, "dope"],
  [/\bs\*+x\b/gi, "sex"],
  [/\bs\*{2}(?![a-zA-Z0-9*])/gi, "sex"],
  [/\bt\*+ts\b/gi, "tits"],
  [/\bt\*{2}s\b/gi, "tits"],
];

function applyCasing(match: string, replacement: string): string {
  const letters = match.replace(/[^a-zA-Z]/g, "");
  if (!letters) return replacement;

  const isAllUpper =
    letters.length > 1 ? letters === letters.toUpperCase() : false;
  const isFirstUpper =
    match[0] === match[0]?.toUpperCase() &&
    match[0] !== match[0]?.toLowerCase();

  if (isAllUpper) {
    return replacement.toUpperCase();
  }
  if (isFirstUpper) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement.toLowerCase();
}

export function fixExplicitText(text: string): string {
  if (!text || typeof text !== "string" || !text.includes("*")) {
    return text;
  }

  let result = text;
  for (const [regex, replacement] of EXPLICIT_REPLACEMENTS) {
    result = result.replace(regex, (match) => applyCasing(match, replacement));
  }

  return result;
}

export function fixExplicitLyrics(
  payload: SyncedLyricsPayload,
): SyncedLyricsPayload {
  if (!Array.isArray(payload)) return payload;

  return payload.map((line: CompactLyricLine) => {
    if (!Array.isArray(line)) return line;
    return line.map((wordToken: CompactLyricWord) => {
      const [type, startMs, lengthMs, text] = wordToken;
      const cleanText = fixExplicitText(text);
      if (cleanText === text) return wordToken;
      return [type, startMs, lengthMs, cleanText] as CompactLyricWord;
    });
  });
}
