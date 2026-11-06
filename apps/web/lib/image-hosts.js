// Plain JS so next.config.js can import it as well as the app code.

/**
 * Hosts that serve cover art and that the Next.js image optimizer may fetch
 * from. A leading "**." matches any subdomain.
 */
export const COVER_IMAGE_HOSTS = [
  "**.mzstatic.com", // Apple Music
  "**.dzcdn.net", // Deezer
  "i.scdn.co", // Spotify
  "**.spotifycdn.com", // Spotify
  "**.music.126.net", // NetEase Cloud Music
  "y.gtimg.cn", // QQ Music
];

/**
 * Whether the optimizer is allowed to fetch this URL. URLs on any other host
 * have to be shown as they are, because next/image throws on unlisted hosts.
 *
 * @param {string} src
 * @returns {boolean}
 */
export function isOptimizableImage(src) {
  let hostname;
  try {
    ({ hostname } = new URL(src));
  } catch {
    return false;
  }
  return COVER_IMAGE_HOSTS.some((host) =>
    host.startsWith("**.")
      ? hostname.endsWith(host.slice(2))
      : hostname === host,
  );
}
