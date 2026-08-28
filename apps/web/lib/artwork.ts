import { formatArtworkUrl } from "@repo/music-resolver/artwork";
import type { ArtworkMetadata } from "@repo/types";

export { formatArtworkUrl };

export function resolveTrackArtwork(
  artwork?: ArtworkMetadata | null,
  size: number = 600,
): { imageCover?: string; videoCover?: string } {
  if (!artwork) return {};

  const videoCover = artwork.squareVideoUrl || artwork.tallVideoUrl || undefined;
  const imageCover = formatArtworkUrl(artwork, size) || undefined;

  return { imageCover, videoCover };
}

