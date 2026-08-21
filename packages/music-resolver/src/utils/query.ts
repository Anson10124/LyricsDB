// Cleans a search query by removing problematic typographic characters
// while preserving valid content
export function cleanSearchQuery(query: string): string {
  if (!query) return "";
  return (
    query
      // Normalize NFKD unicode characters
      .normalize("NFKD")
      // Remove diacritics/accents (e.g. é -> e, ñ -> n, ü -> u, ø -> o)
      .replace(/[\u0300-\u036f]/g, "")
      // Remove special quotation marks (German „", French «», Asian 『』, etc.)
      .replace(
        /[\u201E\u201C\u201D\u00AB\u00BB\u2039\u203A\u300E\u300F\u300C\u300D\uFF02]/g,
        "",
      )
      // Normalize fancy apostrophes to standard apostrophe
      .replace(/[\u2018\u2019\u201A\u201B\uFF07]/g, "'")
      // Normalize middle dots (Western & CJK)
      .replace(/[\u00B7\u30FB\u2022\u2219]/g, " ")
      // Normalize dash types to standard hyphen
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFF0D]/g, "-")
      // Replace CJK full-width parentheses with standard
      .replace(/\uFF08/g, "(")
      .replace(/\uFF09/g, ")")
      // Replace CJK corner/lenticular brackets with standard brackets
      .replace(/[\u3010\u3008]/g, "[")
      .replace(/[\u3011\u3009]/g, "]")
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      // Collapse multiple spaces and trim
      .replace(/\s+/g, " ")
      .trim()
  );
}

export interface TitleNormalizationResult {
  cleanTitle: string;
  rawNormalized: string;
  extraArtists: string[];
  isLive: boolean;
  isAcoustic: boolean;
  isRemix: boolean;
  isInstrumental: boolean;
  isKaraoke: boolean;
  isCover: boolean;
  isTribute: boolean;
}

export function normalizeSongTitle(rawTitle: string): TitleNormalizationResult {
  const cleanedRaw = cleanSearchQuery(rawTitle);
  let title = cleanedRaw;

  const extraArtists: string[] = [];

  const isLive = /\b(live(\s+(at|in|from|version))?)\b/i.test(title);
  const isAcoustic = /\b(acoustic(\s+version)?|unplugged)\b/i.test(title);
  const isRemix = /\b(remix|vip|club\s+mix|extended\s+mix|dub\s+mix)\b/i.test(
    title,
  );
  const isInstrumental =
    /\b(instrumental|karaoke\s+version|backing\s+track)\b/i.test(title);
  const isKaraoke = /\b(karaoke|sing-along|in\s+the\s+style\s+of)\b/i.test(
    title,
  );
  const isCover =
    /\b(tribute\s+band|cover\s+version|tribute\s+to|originally\s+performed\s+by)\b/i.test(
      title,
    );
  const isTribute = /\b(tribute\s+to|tribute\s+band|tribute\s+version)\b/i.test(
    title,
  );

  // 1. Extract and remove featuring artists from title:
  // e.g. "(feat. Artist)", "[feat. Artist]", "feat. Artist", "(ft. Artist)", "(with Artist)"
  title = title.replace(
    /[([{]?(?:feat\.?|ft\.?|featuring|with|prod\.?\s+by)\s+([^)}\]]+)[)}\]]?/gi,
    (_, artists) => {
      const split = splitArtists(artists);
      extraArtists.push(...split);
      return "";
    },
  );

  // 2. Remove common noisy version tags:
  // - Remastered info: (Remastered 2011), (2021 Remaster), (2009 Digital Remaster), - Remastered
  title = title.replace(
    /[([](?:(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+(?:digital\s+)?remaster(?:ed)?|remastered|remaster)[)\]]/gi,
    "",
  );

  // - Editions: (Deluxe Edition), [Deluxe], (Super Deluxe), (Bonus Track), (Anniversary Edition), (Expanded Edition)
  title = title.replace(
    /[([](?:(?:super\s+)?deluxe(?:\s+edition)?|bonus\s+track(?:\s+version)?|anniversary\s+edition|expanded\s+edition|special\s+edition|collector'?s?\s+edition)[)\]]/gi,
    "",
  );

  // - Mix / Version tags (keep remix info if not noise, but clean generic tags)
  title = title.replace(
    /[([](?:radio\s+edit|single\s+version|album\s+version|original\s+version|original\s+mix|stereo|mono|explicit|clean|explicit\s+version|clean\s+version)[)\]]/gi,
    "",
  );

  // - Video / Audio / Web tags: (Official Music Video), (Official Audio), (Audio), (Lyric Video)
  title = title.replace(
    /[([](?:official\s+music\s+video|official\s+video|official\s+audio|audio|lyric\s+video|visualizer|hd|4k)[)\]]/gi,
    "",
  );

  // - Soundtrack tags: (From "Movie Title" Soundtrack)
  title = title.replace(
    /[([](?:from\s+["'].*?["'](?:\s+soundtrack)?|original\s+motion\s+picture\s+soundtrack|ost)[)\]]/gi,
    "",
  );

  // 3. Remove trailing dash metadata: " - Remastered 2011", " - Single", " - Stereo"
  title = title.replace(
    /\s*-\s*(?:(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster|single|stereo|mono|radio\s+edit|explicit|clean)$/i,
    "",
  );

  // 4. Remove empty brackets remaining e.g. " ()", " []"
  title = title.replace(/[([{]\s*[)}\]]/g, "");

  // 5. Trim, normalize spacing
  const cleanTitle = title.replace(/\s+/g, " ").trim();

  return {
    cleanTitle: cleanTitle || cleanedRaw,
    rawNormalized: cleanedRaw,
    extraArtists: Array.from(new Set(extraArtists.filter(Boolean))),
    isLive,
    isAcoustic,
    isRemix,
    isInstrumental,
    isKaraoke,
    isCover,
    isTribute,
  };
}

export function splitArtists(artistStr?: string): string[] {
  if (!artistStr) return [];
  const cleaned = cleanSearchQuery(artistStr);
  return cleaned
    .split(
      /(?:\s*,\s*|\s*;\s*|\s*&\s*|\s*\/\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+with\s+|\s+x\s+|\s+X\s+|\s+and\s+|、|，)/i,
    )
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

export function normalizeArtistName(artist: string): string {
  if (!artist) return "";
  return cleanSearchQuery(artist)
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5\u3040-\u30ff]/g, "")
    .trim();
}
