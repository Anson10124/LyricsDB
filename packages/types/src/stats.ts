export interface LibraryStatsTotals {
  tracks: number;
  withLyrics: number;
  word: number;
  line: number;
  plain: number;
  none: number;
  translation: number;
  romaji: number;
  verified: number;
}

export interface LibraryProviderStats {
  provider: string;
  total: number;
  word: number;
  line: number;
  plain: number;
}

export type LibraryPlatform =
  | "spotify"
  | "appleMusic"
  | "deezer"
  | "netease"
  | "qqMusic";

export interface LibraryPlatformStats {
  platform: LibraryPlatform;
  count: number;
}

export interface LibraryDailyStats {
  // UTC day, YYYY-MM-DD
  date: string;
  count: number;
}

export interface LibraryStats {
  generatedAt: number;
  totals: LibraryStatsTotals;
  providers: LibraryProviderStats[];
  platforms: LibraryPlatformStats[];
  dailyAdded: LibraryDailyStats[];
}
