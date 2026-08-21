import type { AnimatedArtworkPayload, ResolveOptions } from "../types.js";
import { HttpClient } from "./http.js";
import { extractHighestQualityMp4FromM3u8 } from "./m3u8-parser.js";

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
      editorialVideo?: EditorialVideoPayload;
    };
    relationships?: {
      albums?: {
        data?: Array<{ id: string; type: string }>;
      };
    };
  }>;
}

export interface AppleAnimatedArtworkOptions extends ResolveOptions {
  apiUrl?: string;
  country?: string;
  getToken?: (
    options?: ResolveOptions,
    forceRefresh?: boolean,
  ) => Promise<string>;
}

export async function fetchAppleAnimatedArtwork(
  id: string,
  type: "song" | "album" | "artist" = "song",
  options?: AppleAnimatedArtworkOptions,
): Promise<AnimatedArtworkPayload | null> {
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

    let editorialVideo: EditorialVideoPayload | undefined;

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

      editorialVideo = res?.data?.[0]?.attributes?.editorialVideo;
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

      editorialVideo = res?.data?.[0]?.attributes?.editorialVideo;
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

      editorialVideo = songRes?.data?.[0]?.attributes?.editorialVideo;

      // If song doesn't have direct editorial video, query associated album
      if (!editorialVideo) {
        const albumId = songRes?.data?.[0]?.relationships?.albums?.data?.[0]?.id;
        if (albumId) {
          const albumRes = await executeGet(
            `/v1/catalog/${encodeURIComponent(country)}/albums/${encodeURIComponent(albumId)}?extend=editorialVideo`,
            token,
          );
          editorialVideo = albumRes?.data?.[0]?.attributes?.editorialVideo;
        }
      }
    }

    if (!editorialVideo) {
      return null;
    }

    const squareMotion =
      editorialVideo.motionDetailSquare ||
      editorialVideo.motionSquareVideo1x1 ||
      editorialVideo.motionArtistSquare1x1;

    const tallMotion =
      editorialVideo.motionDetailTall ||
      editorialVideo.motionTallVideo3x4 ||
      editorialVideo.motionArtistFullscreen16x9;

    const squareHlsUrl = squareMotion?.video;
    const tallHlsUrl = tallMotion?.video;

    if (!squareHlsUrl && !tallHlsUrl) {
      return null;
    }

    // Extract direct MP4 URLs in parallel
    const [squareVideoUrl, tallVideoUrl] = await Promise.all([
      squareHlsUrl
        ? extractHighestQualityMp4FromM3u8(squareHlsUrl, timeout)
        : Promise.resolve(null),
      tallHlsUrl
        ? extractHighestQualityMp4FromM3u8(tallHlsUrl, timeout)
        : Promise.resolve(null),
    ]);

    const primaryPreview = squareMotion?.previewFrame || tallMotion?.previewFrame;
    let previewFrameUrl = primaryPreview?.url;
    if (previewFrameUrl) {
      previewFrameUrl = previewFrameUrl
        .replace("{w}", "1080")
        .replace("{h}", "1080");
    }

    return {
      squareVideoUrl: squareVideoUrl || undefined,
      tallVideoUrl: tallVideoUrl || undefined,
      squareHlsUrl: squareHlsUrl || undefined,
      tallHlsUrl: tallHlsUrl || undefined,
      previewFrameUrl: previewFrameUrl || undefined,
      bgColor: primaryPreview?.bgColor ? `#${primaryPreview.bgColor}` : undefined,
      textColor1: primaryPreview?.textColor1
        ? `#${primaryPreview.textColor1}`
        : undefined,
      textColor2: primaryPreview?.textColor2
        ? `#${primaryPreview.textColor2}`
        : undefined,
    };
  } catch {
    return null;
  }
}
