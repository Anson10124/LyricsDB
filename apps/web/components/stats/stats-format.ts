import type { LibraryPlatform } from "@repo/types";

export const SYNC_TYPES = [
  { key: "word", label: "Word-synced", color: "var(--sync-word)" },
  { key: "line", label: "Line-synced", color: "var(--sync-line)" },
  { key: "plain", label: "Plain", color: "var(--sync-plain)" },
  { key: "none", label: "No lyrics", color: "var(--sync-none)" },
] as const;

export type SyncTypeKey = (typeof SYNC_TYPES)[number]["key"];

const PROVIDER_LABELS: Record<string, string> = {
  "amll-db": "AMLL DB",
  "lrc-red": "LRC Red",
  deezer: "Deezer",
  lrclib: "LRCLIB",
  lyricify: "Lyricify",
  musixmatch: "Musixmatch",
  netease: "NetEase",
  qqmusic: "QQ Music",
  unknown: "Unknown",
};

export const PLATFORM_LABELS: Record<LibraryPlatform, string> = {
  spotify: "Spotify",
  appleMusic: "Apple Music",
  deezer: "Deezer",
  netease: "NetEase",
  qqMusic: "QQ Music",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider.toLowerCase()] ?? provider;
}

export function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function formatPercent(part: number, whole: number): string {
  const value = ratio(part, whole) * 100;
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export const formatCount = (value: number) => value.toLocaleString("en-US");
