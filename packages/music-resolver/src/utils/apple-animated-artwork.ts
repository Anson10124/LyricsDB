import type { ArtworkMetadata, ResolveOptions } from "../types.js";
import { HttpClient } from "./http.js";
import { extractHighestQualityMp4FromM3u8 } from "./m3u8-parser.js";

interface AppleCatalogArtwork {
  url?: string;
  width?: number;
  height?: number;
  bgColor?: string;
  textColor1?: string;
  textColor2?: string;
  textColor3?: string;
  textColor4?: string;
  hasP3?: boolean;
}

interface EditorialVideoItem {
  video?: string;
  previewFrame?: {
    url?: string;
    bgColor?: string;
    textColor1?: string;
    textColor2?: string;
    textColor3?: string;
    textColor4?: string;
    width?: number;
    height?: number;
  };
}

interface EditorialVideoPayload {
  motionDetailSquare?: EditorialVideoItem;
  motionDetailTall?: EditorialVideoItem;
  motionSquareVideo1x1?: EditorialVideoItem;
  motionTallVideo3x4?: EditorialVideoItem;
  motionArtistSquare1x1?: EditorialVideoItem;
  motionArtistFullscreen16x9?: EditorialVideoItem;
}

interface AmpCatalogResponse {
  data?: Array<{
    id: string;
    type: string;
    attributes?: {
      artwork?: AppleCatalogArtwork;
      editorialVideo?: EditorialVideoPayload;
    };
    relationships?: {
      albums?: {
        data?: Array<{ id: string; type: string }>;
      };
    };
  }>;
}

export interface AppleArtworkOptions extends ResolveOptions {
  apiUrl?: string;
  country?: string;
  getToken?: (
    options?: ResolveOptions,
    forceRefresh?: boolean,
  ) => Promise<string>;
}

export async function fetchAppleArtworkMetadata(
  id: string,
  type: "song" | "album" | "artist" = "song",
  options?: AppleArtworkOptions,
): Promise<ArtworkMetadata | null> {
  if (!id || !/^\d+$/.test(id)) {
    return null;
  }

  if (!options?.getToken) {
    return null;
  }

  const country = options.preferredCountry || options.country || "us";
  const baseUrl = options.apiUrl || "https://amp-api.music.apple.com";
  const timeout = options.timeout ?? 8000;

  const executeGet = async (
    path: string,
    token: string,
  ): Promise<AmpCatalogResponse | null> => {
    const url = `${baseUrl}${path}`;
    try {
      return await HttpClient.get<AmpCatalogResponse>(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://music.apple.com",
          Referer: "https://music.apple.com/",
        },
        timeout,
        retries: 0,
      });
    } catch {
      return null;
    }
  };

  try {
    let token = await options.getToken(options);
    if (!token) return null;

    type AmpCatalogItem = NonNullable<AmpCatalogResponse["data"]>[number];
    let catalogItem: AmpCatalogItem | undefined = undefined;
    let albumCatalogItem: AmpCatalogItem | undefined = undefined;

    if (type === "album") {
      let res = await executeGet(
        `/v1/catalog/${encodeURIComponent(country)}/albums/${encodeURIComponent(id)}?extend=editorialVideo`,
        token,
      );

      // Handle 401 token refresh
      if (!res) {
        token = await options.getToken(options, true);
        res = await executeGet(
          `/v1/catalog/${encodeURIComponent(country)}/albums/${encodeURIComponent(id)}?extend=editorialVideo`,
          token,
        );
      }

      catalogItem = res?.data?.[0];
    } else if (type === "artist") {
      let res = await executeGet(
        `/v1/catalog/${encodeURIComponent(country)}/artists/${encodeURIComponent(id)}?extend=editorialVideo`,
        token,
      );

      if (!res) {
        token = await options.getToken(options, true);
        res = await executeGet(
          `/v1/catalog/${encodeURIComponent(country)}/artists/${encodeURIComponent(id)}?extend=editorialVideo`,
          token,
        );
      }

      catalogItem = res?.data?.[0];
    } else {
      // type === "song"
      let songRes = await executeGet(
        `/v1/catalog/${encodeURIComponent(country)}/songs/${encodeURIComponent(id)}?extend=editorialVideo,albums`,
        token,
      );

      if (!songRes) {
        token = await options.getToken(options, true);
        songRes = await executeGet(
          `/v1/catalog/${encodeURIComponent(country)}/songs/${encodeURIComponent(id)}?extend=editorialVideo,albums`,
          token,
        );
      }

      catalogItem = songRes?.data?.[0];

      // If song doesn't have direct editorial video, query associated album
      const albumId = songRes?.data?.[0]?.relationships?.albums?.data?.[0]?.id;
      if (albumId && !catalogItem?.attributes?.editorialVideo) {
        const albumRes = await executeGet(
          `/v1/catalog/${encodeURIComponent(country)}/albums/${encodeURIComponent(albumId)}?extend=editorialVideo`,
          token,
        );
        albumCatalogItem = albumRes?.data?.[0];
      }
    }

    const staticArtwork =
      catalogItem?.attributes?.artwork || albumCatalogItem?.attributes?.artwork;
    const editorialVideo =
      catalogItem?.attributes?.editorialVideo ||
      albumCatalogItem?.attributes?.editorialVideo;

    if (!staticArtwork && !editorialVideo) {
      return null;
    }

    const squareMotion =
      editorialVideo?.motionDetailSquare ||
      editorialVideo?.motionSquareVideo1x1 ||
      editorialVideo?.motionArtistSquare1x1;

    const tallMotion =
      editorialVideo?.motionDetailTall ||
      editorialVideo?.motionTallVideo3x4 ||
      editorialVideo?.motionArtistFullscreen16x9;

    const squareHlsUrl = squareMotion?.video;
    const tallHlsUrl = tallMotion?.video;

    // Extract direct MP4 URLs in parallel if HLS exists
    let squareVideoUrl: string | null = null;
    let tallVideoUrl: string | null = null;

    if (squareHlsUrl || tallHlsUrl) {
      [squareVideoUrl, tallVideoUrl] = await Promise.all([
        squareHlsUrl
          ? extractHighestQualityMp4FromM3u8(squareHlsUrl, timeout)
          : Promise.resolve(null),
        tallHlsUrl
          ? extractHighestQualityMp4FromM3u8(tallHlsUrl, timeout)
          : Promise.resolve(null),
      ]);
    }

    const primaryPreview =
      squareMotion?.previewFrame || tallMotion?.previewFrame;
    let previewFrameUrl = primaryPreview?.url;
    if (previewFrameUrl) {
      previewFrameUrl = previewFrameUrl
        .replace("{w}", "1080")
        .replace("{h}", "1080")
        .replace("{c}", "bb")
        .replace("{f}", "jpg");
    }

    const rawTemplateUrl = staticArtwork?.url;
    let defaultUrl: string | undefined;
    if (rawTemplateUrl) {
      defaultUrl = rawTemplateUrl
        .replace("{w}", "1000")
        .replace("{h}", "1000")
        .replace("{c}", "bb")
        .replace("{f}", "jpg");
    }

    const formatColor = (c?: string) => {
      if (!c) return undefined;
      return c.startsWith("#") ? c : `#${c}`;
    };

    const bgColor =
      formatColor(staticArtwork?.bgColor) ||
      formatColor(primaryPreview?.bgColor);
    const textColor1 =
      formatColor(staticArtwork?.textColor1) ||
      formatColor(primaryPreview?.textColor1);
    const textColor2 =
      formatColor(staticArtwork?.textColor2) ||
      formatColor(primaryPreview?.textColor2);
    const textColor3 =
      formatColor(staticArtwork?.textColor3) ||
      formatColor(primaryPreview?.textColor3);
    const textColor4 =
      formatColor(staticArtwork?.textColor4) ||
      formatColor(primaryPreview?.textColor4);

    return {
      url: defaultUrl,
      templateUrl: rawTemplateUrl,
      width: staticArtwork?.width,
      height: staticArtwork?.height,
      bgColor,
      textColor1,
      textColor2,
      textColor3,
      textColor4,
      hasP3: staticArtwork?.hasP3 ?? false,
      squareVideoUrl: squareVideoUrl || undefined,
      tallVideoUrl: tallVideoUrl || undefined,
      squareHlsUrl: squareHlsUrl || undefined,
      tallHlsUrl: tallHlsUrl || undefined,
      previewFrameUrl: previewFrameUrl || undefined,
    };
  } catch {
    return null;
  }
}

// Alias for backward compatibility
export const fetchAppleAnimatedArtwork = fetchAppleArtworkMetadata;

