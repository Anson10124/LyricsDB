// Shared Musixmatch API settings.
//
// Since September 2026 the desktop host (apic-desktop.musixmatch.com) is poisoned:
// token.get returns an all-zero token and every lookup returns the same decoy
// track ("NOKIA" by Drake) with generated gibberish lyrics. The iOS app host still
// serves real data through the same API, so all calls go there.
export const MUSIXMATCH_API_BASE = "https://apic-appmobile.musixmatch.com/ws/1.1";
export const MUSIXMATCH_APP_ID = "mac-ios-v2.0";
export const MUSIXMATCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

// Track ids Musixmatch returns as decoys instead of the requested track
export const MUSIXMATCH_DECOY_TRACK_IDS: ReadonlySet<number> = new Set([
  226291677, // "NOKIA" by Drake
]);

export function isMusixmatchDecoyTrackId(trackId: unknown): boolean {
  const id = typeof trackId === "string" ? Number(trackId) : trackId;
  return typeof id === "number" && MUSIXMATCH_DECOY_TRACK_IDS.has(id);
}

// True for a token that can actually be used: rejects the all-zero dummy token
// and the "Upgrade. Paid script." refusal
export function isUsableMusixmatchToken(
  token: string | undefined | null,
): token is string {
  if (!token) return false;
  const trimmed = token.trim();
  if (!trimmed || trimmed === "Upgrade. Paid script.") return false;
  return !/^0+$/.test(trimmed);
}

// Random cache-busting value for the `t` query parameter
export function generateMusixmatchRandomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
