export type SupportedPlatform = 'spotify' | 'deezer' | 'netease' | 'apple' | 'qq' | 'isrc';

/**
 * Normalizes user or external platform string identifiers to canonical form.
 * e.g. "apple-music", "applemusic", "apple" -> "apple"
 *      "163", "netease" -> "netease"
 *      "qqmusic", "qq" -> "qq"
 */
export function normalizePlatform(platform: string): string {
  const p = platform.toLowerCase().replace(/[-_]/g, '');
  if (p === 'applemusic' || p === 'apple' || p === 'itunes') return 'apple';
  if (p === '163' || p === 'netease' || p === 'neteasemusic') return 'netease';
  if (p === 'qqmusic' || p === 'qq') return 'qq';
  if (p === 'spotify') return 'spotify';
  if (p === 'deezer') return 'deezer';
  if (p === 'isrc') return 'isrc';
  return p;
}

/**
 * Builds the canonical public streaming URL for a given platform and track ID.
 */
export function buildPlatformUrl(platform: string, id: string): string {
  const norm = normalizePlatform(platform);
  switch (norm) {
    case 'spotify':
      return `https://open.spotify.com/track/${id}`;
    case 'deezer':
      return `https://www.deezer.com/track/${id}`;
    case 'netease':
      return `https://music.163.com/#/song?id=${id}`;
    case 'apple':
      return `https://music.apple.com/song/${id}`;
    case 'qq':
      return `https://y.qq.com/n/ryqq/songDetail/${id}`;
    default:
      throw new Error(`Cannot build URL for platform: ${platform}`);
  }
}

/**
 * Derives the streaming platform name and track ID from an arbitrary streaming service URL.
 */
export function derivePlatformAndIdFromUrl(url: string): { platform: string; id: string } | null {
  const trimmed = url.trim();

  // Spotify
  if (trimmed.startsWith('spotify:track:')) {
    const id = trimmed.split(':')[2]?.split('?')[0];
    if (id) return { platform: 'spotify', id };
  }
  if (trimmed.includes('spotify.com')) {
    const match = trimmed.match(/track\/([a-zA-Z0-9]+)/);
    if (match?.[1]) return { platform: 'spotify', id: match[1] };
  }
  if (trimmed.includes('spotify.link') || trimmed.includes('spotify.app.link') || trimmed.includes('spoti.fi')) {
    const id = trimmed.split('/').pop()?.split('?')[0];
    if (id) return { platform: 'spotify', id };
  }

  // Deezer
  if (trimmed.includes('deezer.com')) {
    const match = trimmed.match(/track\/(\d+)/);
    if (match?.[1]) return { platform: 'deezer', id: match[1] };
  }

  // NetEase
  if (trimmed.includes('163.com') || trimmed.includes('163cn.tv')) {
    const match = trimmed.match(/id=(\d+)/);
    if (match?.[1]) return { platform: 'netease', id: match[1] };
  }

  // Apple Music
  if (trimmed.includes('music.apple.com') || trimmed.includes('itunes.apple.com')) {
    const match = trimmed.match(/i=(\d+)/) || trimmed.match(/\/(\d+)(?:\?|$)/);
    if (match?.[1]) return { platform: 'apple', id: match[1] };
  }

  // QQ Music
  if (trimmed.includes('y.qq.com') || trimmed.includes('qqmusic.qq.com') || trimmed.includes('c.y.qq.com')) {
    const match = trimmed.match(/songDetail\/([a-zA-Z0-9]+)/) || trimmed.match(/song\/([a-zA-Z0-9]+)/);
    if (match?.[1]) return { platform: 'qq', id: match[1] };
  }

  return null;
}
