import type { ArtworkMetadata } from "@repo/types";

/**
 * Resolves a displayable artwork image URL from an ArtworkMetadata object.
 * If a parametric templateUrl is present (e.g. from Apple Music or NetEase),
 * it dynamically substitutes the requested width and height dimensions.
 */
export function formatArtworkUrl(
  artwork?: ArtworkMetadata | null,
  size: number = 600,
): string | undefined {
  if (!artwork) return undefined;

  if (artwork.templateUrl) {
    return artwork.templateUrl
      .replace("{w}", String(size))
      .replace("{h}", String(size))
      .replace("{c}", "bb")
      .replace("{f}", "jpg");
  }

  return artwork.url || undefined;
}
