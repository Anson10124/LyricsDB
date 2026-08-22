import type {
  CompactLyricLine,
  CompactLyricWord,
  SyncedLyricsPayload,
} from "@repo/types";

export const PROFANITY_DICTIONARY: string[] = [
  "motherfucker",
  "motherfuckers",
  "motherfucking",
  "motherfuckin",
  "motherfuck",
  "bullshit",
  "bullshits",
  "fucker",
  "fuckers",
  "fucking",
  "fuckin",
  "fucked",
  "fucks",
  "fuck",
  "shitty",
  "shits",
  "shitting",
  "shit",
  "bitches",
  "bitching",
  "bitchin",
  "bitchy",
  "bitch",
  "asshole",
  "assholes",
  "asses",
  "ass",
  "bastard",
  "bastards",
  "niggers",
  "nigger",
  "niggas",
  "nigga",
  "pussies",
  "pussy",
  "dicks",
  "dick",
  "cocks",
  "cock",
  "cocksucker",
  "cocksuckers",
  "cunts",
  "cunt",
  "dammit",
  "damn",
  "whores",
  "whore",
  "hoes",
  "hoe",
  "cocaine",
  "weed",
  "dope",
  "sex",
  "tits",
  "titties",
  "slut",
  "sluts",
  "douche",
  "douchebag",
  "jackass",
  "dipshit",
  "dumbass",
];

const PROFANITY_PRIORITY: Record<string, number> = {
  shit: 100,
  fuck: 100,
  bitch: 100,
  motherfucker: 100,
  motherfucking: 100,
  bullshit: 100,
  fucking: 95,
  bitches: 95,
  asshole: 95,
  nigga: 95,
  niggas: 90,
  nigger: 90,
  pussy: 90,
  dick: 90,
  cock: 90,
  cunt: 90,
  fucker: 85,
  fucked: 85,
  fucks: 85,
  shits: 85,
  shitty: 85,
  ass: 80,
  asses: 80,
  damn: 80,
  whore: 75,
  whores: 75,
  hoe: 70,
  hoes: 70,
  slut: 65,
  sluts: 65,
};

const CONTEXTUAL_PHRASE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(it'?s\s+britney)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 bitch"],
  [/\b(son\s+of\s+a)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 bitch"],
  [/\b(bad)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 bitch"],
  [/\b(basic)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 bitch"],
  [/\b(what\s+the)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 fuck"],
  [
    /\b(shut\s+the)\s+[*#@$%!_-]{3,6}\s+(up)(?![a-zA-Z0-9*])/gi,
    "$1 fuck $2",
  ],
  [
    /\b(don'?t\s+give\s+a|give\s+a|gives\s+a)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi,
    "$1 fuck",
  ],
  [
    /\b(who\s+the|how\s+the|why\s+the|where\s+the)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi,
    "$1 fuck",
  ],
  [/\b(holy)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 shit"],
  [/\b(piece\s+of)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 shit"],
  [/\b(full\s+of)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 shit"],
  [/\b(talk|talking)\s+[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "$1 shit"],
  [
    /\b(mother)\s*[*#@$%!_-]{3,6}(?:er|ers)(?![a-zA-Z0-9*])/gi,
    "motherfucker",
  ],
  [
    /\b(mother)\s*[*#@$%!_-]{3,6}(?:ing|in'?)(?![a-zA-Z0-9*])/gi,
    "motherfucking",
  ],
  [/\b(mother)\s*[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "motherfuck"],
  [/\b(bull)\s*[*#@$%!_-]{3,6}(?![a-zA-Z0-9*])/gi, "bullshit"],
];

const EXPLICIT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bmotherf\*+(?:c?k)?ers?\b/gi, "motherfucker"],
  [/\bmotherf\*{3,}ers?\b/gi, "motherfucker"],
  [/\bmotherf\*+(?:c?k)?(?:ing|in'?)(?![a-zA-Z0-9])/gi, "motherfucking"],
  [/\bmotherf\*{3,}(?:ing|in'?)(?![a-zA-Z0-9])/gi, "motherfucking"],
  [/\bmotherf\*+(?:c?k)?\b/gi, "motherfuck"],
  [/\bmotherf\*{3,}(?![a-zA-Z0-9*])/gi, "motherfuck"],
  [/\bm\*{3,}rf\*{3,}r\b/gi, "motherfucker"],

  [/\bbullsh\*+t\b/gi, "bullshit"],
  [/\bbulls\*{2,}t?\b/gi, "bullshit"],
  [/\bbullsh\*{2,}(?![a-zA-Z0-9*])/gi, "bullshit"],
  [/\bb\*{2,}sh\*+t\b/gi, "bullshit"],

  [/\bf\*+(?:c?k)?(?:ing|in'?)(?![a-zA-Z0-9])/gi, "fucking"],
  [/\bf\*{2,}(?:ing|in'?)(?![a-zA-Z0-9])/gi, "fucking"],
  [/\bf\*+(?:c?k)?ers?\b/gi, "fucker"],
  [/\bf\*{2,}ers?\b/gi, "fucker"],
  [/\bf\*+(?:c?k)?ed\b/gi, "fucked"],
  [/\bf\*{2,}ed\b/gi, "fucked"],
  [/\bf\*+(?:c?k)?s\b/gi, "fucks"],
  [/\bf\*{2,}s\b/gi, "fucks"],
  [/\bf\*+ck\b/gi, "fuck"],
  [/\bfu\*+k\b/gi, "fuck"],
  [/\bf\*{2,}k\b/gi, "fuck"],
  [/\bf\*{3,4}(?![a-zA-Z0-9*])/gi, "fuck"],

  [/\bsh\*+tty\b/gi, "shitty"],
  [/\bs\*{2,}tty\b/gi, "shitty"],
  [/\bsh\*+ts\b/gi, "shits"],
  [/\bs\*{2,}ts\b/gi, "shits"],
  [/\bsh\*+t\b/gi, "shit"],
  [/\bs\*{2,}t\b/gi, "shit"],
  [/\bsh\*{2,}(?![a-zA-Z0-9*])/gi, "shit"],
  [/\bs\*{3,}(?![a-zA-Z0-9*])/gi, "shit"],

  [/\bb\*+tches\b/gi, "bitches"],
  [/\bb\*{2,}hes\b/gi, "bitches"],
  [/\bb\*{3,}es\b/gi, "bitches"],
  [/\bb\*{4,}s\b/gi, "bitches"],
  [/\bb\*+tch\b/gi, "bitch"],
  [/\bb\*{2,}h\b/gi, "bitch"],
  [/\bb\*{3,4}(?![a-zA-Z0-9*])/gi, "bitch"],

  [/\ba\*+sholes?\b/gi, "asshole"],
  [/\ba\*{2,}holes?\b/gi, "asshole"],
  [/\bassh\*+les?\b/gi, "asshole"],
  [/\ba\*{5,}e\b/gi, "asshole"],
  [/\ba\*{6,}\b/gi, "asshole"],
  [/\ba\*+ses\b/gi, "asses"],
  [/\ba\*{2,}es\b/gi, "asses"],
  [/\ba\*+s\b/gi, "ass"],
  [/\ba\*{2,}(?![a-zA-Z0-9*])/gi, "ass"],

  [/\bb\*+stards?\b/gi, "bastard"],
  [/\bb\*{2,}tards?\b/gi, "bastard"],
  [/\bb\*{5,}d\b/gi, "bastard"],

  [/\bn\*+ggers\b/gi, "niggers"],
  [/\bn\*{2,}ers\b/gi, "niggers"],
  [/\bn\*+gger\b/gi, "nigger"],
  [/\bn\*{2,}er\b/gi, "nigger"],
  [/\bn\*+ggas\b/gi, "niggas"],
  [/\bn\*{2,}as\b/gi, "niggas"],
  [/\bni\*{2,}as\b/gi, "niggas"],
  [/\bn\*+gga\b/gi, "nigga"],
  [/\bn\*{2,}a\b/gi, "nigga"],
  [/\bni\*{2,}a\b/gi, "nigga"],
  [/\bn\*{3,4}(?![a-zA-Z0-9*])/gi, "nigga"],

  [/\bp\*+ssies\b/gi, "pussies"],
  [/\bp\*{2,}ies\b/gi, "pussies"],
  [/\bp\*+ssy\b/gi, "pussy"],
  [/\bp\*{2,}y\b/gi, "pussy"],
  [/\bp\*{2,}sy\b/gi, "pussy"],
  [/\bp\*{3,4}(?![a-zA-Z0-9*])/gi, "pussy"],

  [/\bd\*+cks\b/gi, "dicks"],
  [/\bd\*{2,}ks\b/gi, "dicks"],
  [/\bd\*+ck\b/gi, "dick"],
  [/\bd\*{2,}k\b/gi, "dick"],
  [/\bd\*{3,}(?![a-zA-Z0-9*])/gi, "dick"],

  [/\bc\*+cks\b/gi, "cocks"],
  [/\bc\*{2,}ks\b/gi, "cocks"],
  [/\bc\*+ck\b/gi, "cock"],
  [/\bc\*{2,}k\b/gi, "cock"],

  [/\bc\*+nts\b/gi, "cunts"],
  [/\bc\*{2,}ts\b/gi, "cunts"],
  [/\bc\*+nt\b/gi, "cunt"],
  [/\bc\*{2,}t\b/gi, "cunt"],
  [/\bc\*{3,}(?![a-zA-Z0-9*])/gi, "cunt"],

  [/\bd\*+mmit\b/gi, "dammit"],
  [/\bd\*{2,}mit\b/gi, "dammit"],
  [/\bd\*+mn\b/gi, "damn"],
  [/\bd\*{2,}n\b/gi, "damn"],
  [/\bd\*{3,}(?![a-zA-Z0-9*])/gi, "damn"],

  [/\bw\*+res\b/gi, "whores"],
  [/\bw\*{2,}es\b/gi, "whores"],
  [/\bw\*+re\b/gi, "whore"],
  [/\bw\*{2,}e\b/gi, "whore"],
  [/\bw\*{4,}(?![a-zA-Z0-9*])/gi, "whore"],

  [/\bh\*+es\b/gi, "hoes"],
  [/\bh\*{2,}s\b/gi, "hoes"],
  [/\bh\*+e\b/gi, "hoe"],
  [/\bh\*{2,}(?![a-zA-Z0-9*])/gi, "hoe"],

  [/\bc\*+caine\b/gi, "cocaine"],
  [/\bc\*{4,}e\b/gi, "cocaine"],
  [/\bw\*+ed\b/gi, "weed"],
  [/\bw\*{2,}d\b/gi, "weed"],
  [/\bd\*+pe\b/gi, "dope"],
  [/\bd\*{2,}e\b/gi, "dope"],
  [/\bs\*+x\b/gi, "sex"],
  [/\bs\*{2,}(?![a-zA-Z0-9*])/gi, "sex"],
  [/\bt\*+ts\b/gi, "tits"],
  [/\bt\*{2,}s\b/gi, "tits"],
  [/\bt\*+tties\b/gi, "titties"],
  [/\bt\*{2,}ties\b/gi, "titties"],
];

export function isMaskedToken(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const core = trimmed.replace(
    /^[^\p{L}\p{N}*#@$%!_-]+|[^\p{L}\p{N}*#@$%!_-]+$/gu,
    "",
  );
  if (!core) return false;

  // Pure mask symbols (e.g. ***, ****, *****, ####, $$$$)
  if (/^[*#@$%!_-]{2,}$/.test(core)) return true;

  // Contains asterisk(s) (e.g. b****, f**k, sh*t, motherf***er, n****)
  if (core.includes("*")) return true;

  // Explicit placeholder tokens
  if (/^\[?(censored|bleep|explicit)\]?$/i.test(core)) return true;

  // Comic profanity symbols e.g. f#@k, b!tch, $#!+, @$$
  if (
    /[a-zA-Z]+[*#@$%!]+[a-zA-Z]*/.test(core) ||
    /[*#@$%!]+[a-zA-Z]+/.test(core)
  ) {
    return true;
  }

  return false;
}

export function containsMaskedTokens(
  lyrics: SyncedLyricsPayload | string | null | undefined,
): boolean {
  if (!lyrics) return false;

  if (typeof lyrics === "string") {
    return (
      isMaskedToken(lyrics) ||
      /[*#@$%!_-]{3,}|\[censored\]|\bb\*+tch\b|\bf\*+ck\b|\bsh\*+t\b/i.test(
        lyrics,
      )
    );
  }

  if (Array.isArray(lyrics)) {
    for (const line of lyrics) {
      if (!Array.isArray(line)) continue;
      for (const token of line) {
        if (!token || !Array.isArray(token) || typeof token[3] !== "string") continue;
        if (isMaskedToken(token[3])) return true;
      }
    }
  }

  return false;
}

export function matchProfanityByShape(maskedWord: string): string | null {
  if (!maskedWord || typeof maskedWord !== "string") return null;

  const clean = maskedWord
    .trim()
    .replace(/^[^\p{L}\p{N}*#@$%!_-]+|[^\p{L}\p{N}*#@$%!_-]+$/gu, "");
  if (!clean || !isMaskedToken(clean)) return null;

  // Build a regex pattern from the masked word
  // e.g. "b***h" -> "^b.{3}h$"
  // e.g. "m****rf****r" -> "^m.{4}rf.{4}r$"
  const regexPattern =
    "^" +
    clean
      .split("")
      .map((char) => {
        if (
          char === "*" ||
          char === "#" ||
          char === "@" ||
          char === "$" ||
          char === "%" ||
          char === "!" ||
          char === "-"
        ) {
          return ".";
        }
        return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("") +
    "$";

  try {
    const reg = new RegExp(regexPattern, "i");
    const matched = PROFANITY_DICTIONARY.filter(
      (w) => w.length === clean.length && reg.test(w),
    );
    if (matched.length === 1 && matched[0]) {
      return matched[0];
    }
    if (matched.length > 1) {
      // Prioritize highest frequency/severity profanities
      matched.sort(
        (a, b) => (PROFANITY_PRIORITY[b] || 0) - (PROFANITY_PRIORITY[a] || 0),
      );
      if (matched[0]) return matched[0];
    }
  } catch {
    // Ignore invalid regex
  }

  return null;
}

export function applyCasing(
  match: string,
  replacement: string,
  lineContext?: string,
): string {
  const letters = match.replace(/[^a-zA-Z]/g, "");

  if (!letters) {
    // If token has no letters (e.g. "*****"), check surrounding line context
    if (lineContext) {
      const lineLetters = lineContext.replace(/[^a-zA-Z]/g, "");
      if (lineLetters.length > 1 && lineLetters === lineLetters.toUpperCase()) {
        return replacement.toUpperCase();
      }
    }
    return replacement;
  }

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
  if (!text || typeof text !== "string") {
    return text;
  }

  // Preserve leading/trailing whitespace exactly
  const leadingSpaceMatch = text.match(/^\s*/);
  const leadingSpace = leadingSpaceMatch ? leadingSpaceMatch[0] : "";
  const trailingSpaceMatch = text.match(/\s*$/);
  const trailingSpace = trailingSpaceMatch ? trailingSpaceMatch[0] : "";

  const trimmed = text.slice(
    leadingSpace.length,
    text.length - (trailingSpace.length ? trailingSpace.length : 0),
  );

  if (!trimmed) {
    return text;
  }

  let result = trimmed;

  // 1. Contextual phrase replacements (e.g. "It's Britney *****" -> "It's Britney bitch")
  for (const [regex, replacement] of CONTEXTUAL_PHRASE_PATTERNS) {
    result = result.replace(regex, (match) => {
      const lineLetters = match.replace(/[^a-zA-Z]/g, "");
      const isAllUpper =
        lineLetters.length > 1 && lineLetters === lineLetters.toUpperCase();
      const resolved =
        typeof replacement === "string"
          ? match.replace(regex, replacement)
          : replacement;
      return isAllUpper ? resolved.toUpperCase() : resolved;
    });
  }

  // 2. Explicit patterns with asterisks
  if (result.includes("*")) {
    for (const [regex, replacement] of EXPLICIT_REPLACEMENTS) {
      result = result.replace(regex, (match) =>
        applyCasing(match, replacement, trimmed),
      );
    }
  }

  // 3. Profanity shape dictionary match on single masked words if still contains mask
  if (isMaskedToken(result)) {
    const shapeMatch = matchProfanityByShape(result);
    if (shapeMatch) {
      result = applyCasing(result, shapeMatch, trimmed);
    }
  }

  return leadingSpace + result + trailingSpace;
}

export function fixExplicitLyrics(
  payload: SyncedLyricsPayload,
): SyncedLyricsPayload {
  if (!Array.isArray(payload)) return payload;

  return payload.map((line: CompactLyricLine) => {
    if (!Array.isArray(line)) return line;

    return line.map((token) => {
      if (typeof token === "string") return token;
      const [type, startMs, lengthMs, text] = token;
      let cleanText = fixExplicitText(text);

      // If text was unmasked or is a standalone profanity but lacks trailing space,
      // and is not hyphenated (e.g. "fuck" -> "fuck "), ensure proper trailing space
      if (
        cleanText !== text ||
        PROFANITY_DICTIONARY.includes(cleanText.trim().toLowerCase())
      ) {
        if (!cleanText.endsWith(" ") && !cleanText.endsWith("-")) {
          cleanText = cleanText + " ";
        }
      }

      if (cleanText === text) return token;
      return [type, startMs, lengthMs, cleanText] as CompactLyricWord;
    });
  });
}
