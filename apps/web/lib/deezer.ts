export type {
  DeezerArtist,
  DeezerAlbum,
  DeezerTrack,
  DeezerSearchResponse,
} from "@repo/types";
import type { DeezerSearchResponse, DeezerTrack } from "@repo/types";


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
