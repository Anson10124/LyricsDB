import { HttpClient } from "./http.js";

export interface M3u8StreamVariant {
  bandwidth: number;
  resolution?: { width: number; height: number };
  codecs?: string;
  url: string;
}

export function parseMasterM3u8(
  masterContent: string,
  masterUrl: string,
): {
  variants: M3u8StreamVariant[];
  highestQualityVariant?: M3u8StreamVariant;
} {
  const lines = masterContent.split("\n");
  const variants: M3u8StreamVariant[] = [];
  let currentInfo: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      currentInfo = line;
    } else if (line && !line.startsWith("#") && currentInfo) {
      const bwMatch = currentInfo.match(/BANDWIDTH=(\d+)/);
      const resMatch = currentInfo.match(/RESOLUTION=(\d+)x(\d+)/);
      const codecMatch = currentInfo.match(/CODECS="([^"]+)"/);

      const bandwidth = bwMatch ? parseInt(bwMatch[1]!, 10) : 0;
      const resolution = resMatch
        ? {
            width: parseInt(resMatch[1]!, 10),
            height: parseInt(resMatch[2]!, 10),
          }
        : undefined;
      const codecs = codecMatch ? codecMatch[1] : undefined;

      const variantUrl = new URL(line, masterUrl).toString();
      variants.push({
        bandwidth,
        resolution,
        codecs,
        url: variantUrl,
      });

      currentInfo = null;
    }
  }

  // Sort by resolution area descending, then bandwidth descending
  variants.sort((a, b) => {
    const areaA = (a.resolution?.width || 0) * (a.resolution?.height || 0);
    const areaB = (b.resolution?.width || 0) * (b.resolution?.height || 0);
    if (areaA !== areaB) return areaB - areaA;
    return b.bandwidth - a.bandwidth;
  });

  return {
    variants,
    highestQualityVariant: variants[0],
  };
}

export async function extractHighestQualityMp4FromM3u8(
  masterM3u8Url: string,
  timeout = 8000,
): Promise<string | null> {
  try {
    const masterText = await HttpClient.get<string>(masterM3u8Url, { timeout });
    if (!masterText || typeof masterText !== "string") return null;

    const { highestQualityVariant } = parseMasterM3u8(masterText, masterM3u8Url);
    if (!highestQualityVariant) return null;

    const variantText = await HttpClient.get<string>(highestQualityVariant.url, {
      timeout,
    });
    if (!variantText || typeof variantText !== "string") return null;

    // Look for EXT-X-MAP:URI="....mp4"
    const mapMatch = variantText.match(/#EXT-X-MAP:URI="([^"]+\.mp4)"/);
    if (mapMatch && mapMatch[1]) {
      return new URL(mapMatch[1], highestQualityVariant.url).toString();
    }

    // Look for raw segment line ending with .mp4
    const segmentMatch = variantText.match(/^([^#\s]+\.mp4)/m);
    if (segmentMatch && segmentMatch[1]) {
      return new URL(segmentMatch[1], highestQualityVariant.url).toString();
    }

    return null;
  } catch {
    return null;
  }
}
