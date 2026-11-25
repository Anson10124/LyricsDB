import type { Track } from "@repo/database";

// lyricsProvider of lyrics saved from the community editor
export const COMMUNITY_LYRICS_PROVIDER = "community";

export const VERIFIED_REFRESH_ERROR =
  "This track has been verified as correct and can't be refreshed.";
export const EDITED_REFRESH_ERROR =
  "These lyrics were edited by the community and can't be refreshed from providers. Use the editor to change them.";

type LockFields = Pick<Track, "isVerified" | "lyricsProvider">;

// A refresh would replace lyrics a person confirmed or fixed, so both are locked.
// An edit that only fixed IDs doesn't lock, so a refresh can fetch the right song.
export function refreshLockError(
  track: LockFields | null | undefined,
): string | null {
  if (!track) return null;
  if (track.isVerified) return VERIFIED_REFRESH_ERROR;
  if (track.lyricsProvider === COMMUNITY_LYRICS_PROVIDER) {
    return EDITED_REFRESH_ERROR;
  }
  return null;
}
