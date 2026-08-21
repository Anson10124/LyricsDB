export interface DeezerArtist {
  id: number;
  name: string;
  link?: string;
  picture?: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  tracklist?: string;
  type?: string;
}

export interface DeezerAlbum {
  id: number;
  title: string;
  cover?: string;
  cover_small?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  md5_image?: string;
  tracklist?: string;
  type?: string;
}

export interface DeezerTrack {
  id: number;
  readable: boolean;
  title: string;
  title_short: string;
  title_version?: string;
  isrc?: string;
  link: string;
  duration: number;
  rank?: number;
  explicit_lyrics?: boolean;
  explicit_content_lyrics?: number;
  explicit_content_cover?: number;
  preview?: string;
  md5_image?: string;
  artist: DeezerArtist;
  album: DeezerAlbum;
  type: string;
}

export interface DeezerSearchResponse {
  data: DeezerTrack[];
  total: number;
  next?: string;
}

/**
 * Searches tracks on Deezer API directly from the client browser.
 * Uses JSONP (&output=jsonp) to bypass cross-origin restrictions (CORS) reliably without requiring a server proxy.
 */
export function searchDeezerTracks(
  query: string,
  limit = 10,
): Promise<DeezerTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return Promise.resolve([]);
  }

  // Ensure window and document exist (client-side only)
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const callbackId = `dz_cb_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const script = document.createElement("script");

    let isResolved = false;

    const cleanup = () => {
      isResolved = true;
      if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>)[callbackId]) {
        delete (window as unknown as Record<string, unknown>)[callbackId];
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        cleanup();
        reject(new Error("Deezer search request timed out"));
      }
    }, 8000);

    (window as unknown as Record<string, (response: DeezerSearchResponse) => void>)[callbackId] = (
      response: DeezerSearchResponse,
    ) => {
      clearTimeout(timeoutId);
      cleanup();
      if (!response || !Array.isArray(response.data)) {
        resolve([]);
      } else {
        resolve(response.data);
      }
    };

    script.src = `https://api.deezer.com/search/track?q=${encodeURIComponent(
      trimmed,
    )}&limit=${limit}&output=jsonp&callback=${callbackId}`;

    script.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error("Failed to load Deezer search results"));
    };

    document.head.appendChild(script);
  });
}
