import type { MetadataType, ResolveOptions, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { normalizeSongTitle } from '../utils/query.js';
import { getCheerioDoc, metaTagContent } from '../utils/scraper.js';
import { BaseMusicParser } from './base.js';

export const SPOTIFY_LINK_REGEX =
  /^(?:https?:\/\/(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)|(?:spotify\.link|spotify\.app\.link|spoti\.fi))\/([a-zA-Z0-9]+)|spotify:(track|album|playlist|artist|episode|show):([a-zA-Z0-9]+))(?:[?#].*)?$/i;

export const SPOTIFY_LINK_MOBILE_REGEX = /^https?:\/\/(?:spotify\.link|spotify\.app\.link|spoti\.fi)\/(\w+)/i;
export const SPOTIFY_LINK_DESKTOP_REGEX =
  /(https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+))/i;

const SPOTIFY_TYPE_MAP: Record<string, MetadataType> = {
  'music.song': 'song',
  'music.album': 'album',
  'music.playlist': 'playlist',
  profile: 'artist',
  'music.episode': 'podcast',
  website: 'show',
};

interface SpotifyEmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  artists?: Array<{ name: string; uri?: string }>;
  trackList?: Array<{ title?: string; subtitle?: string }>;
  audioPreview?: { url?: string };
  visualIdentity?: { image?: Array<{ url?: string }> };
}

export class SpotifyParser extends BaseMusicParser {
  readonly id = 'spotify';
  readonly name = 'Spotify';

  match(url: string): boolean {
    return (
      SPOTIFY_LINK_REGEX.test(url) ||
      url.startsWith('spotify:') ||
      url.includes('open.spotify.com') ||
      url.includes('spotify.link') ||
      url.includes('spotify.app.link') ||
      url.includes('spoti.fi')
    );
  }

  parse(url: string): { id: string; type?: MetadataType } {
    if (url.startsWith('spotify:')) {
      const parts = url.split(':');
      const rawType = parts[1];
      const id = parts[2] || '';
      return { id, type: this.mapRawType(rawType) };
    }

    const match = url.match(SPOTIFY_LINK_REGEX);
    if (match) {
      const rawType = match[1] || match[3];
      const id = match[2] || match[4] || '';
      return { id, type: this.mapRawType(rawType) };
    }

    const desktopMatch = url.match(SPOTIFY_LINK_DESKTOP_REGEX);
    if (desktopMatch) {
      return { id: desktopMatch[3] || '', type: this.mapRawType(desktopMatch[2]) };
    }

    const id = url.split('/').pop()?.split('?')[0] || '';
    return { id };
  }

  private mapRawType(rawType?: string): MetadataType | undefined {
    if (!rawType) return undefined;
    const lower = rawType.toLowerCase();
    if (lower === 'track') return 'song';
    if (lower === 'album') return 'album';
    if (lower === 'playlist') return 'playlist';
    if (lower === 'artist') return 'artist';
    if (lower === 'episode') return 'podcast';
    if (lower === 'show') return 'show';
    return undefined;
  }

  async fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata> {
    let targetUrl = url;
    let targetId = id;
    const parsed = this.parse(targetUrl);
    let itemType = parsed.type || 'song';

    // If shortlink or URI, resolve to canonical HTTP URL
    if (targetUrl.startsWith('spotify:')) {
      const singularPath = itemType === 'song' ? 'track' : itemType;
      targetUrl = `https://open.spotify.com/${singularPath}/${targetId}`;
    } else if (
      targetUrl.includes('spotify.link') ||
      targetUrl.includes('spotify.app.link') ||
      targetUrl.includes('spoti.fi')
    ) {
      try {
        const headRes = await fetch(targetUrl, { redirect: 'follow', method: 'GET' });
        if (headRes.url && headRes.url !== targetUrl) {
          targetUrl = headRes.url;
          const reParsed = this.parse(targetUrl);
          if (reParsed.id) targetId = reParsed.id;
          if (reParsed.type) itemType = reParsed.type;
        }
      } catch {
        // Fallback to scraping
      }
    }

    const singularPath = itemType === 'song' ? 'track' : itemType;

    // 1. Try Spotify Embed page (contains rich JSON data without any auth)
    try {
      const embedUrl = `https://open.spotify.com/embed/${singularPath}/${targetId}`;
      const embedHtml = await HttpClient.get<string>(embedUrl, {
        timeout: options?.timeout ?? 8000,
        retries: options?.retries ?? 1,
      });

      const doc = getCheerioDoc(embedHtml);
      const nextDataText = doc('#__NEXT_DATA__').text();

      if (nextDataText) {
        const nextData = JSON.parse(nextDataText);
        const entity: SpotifyEmbedEntity | undefined = nextData.props?.pageProps?.state?.data?.entity;

        if (entity && (entity.name || entity.title)) {
          const rawTitle = (entity.name || entity.title || '').trim();
          const normalized = normalizeSongTitle(rawTitle);

          let artists: string[] = [];
          if (entity.artists && entity.artists.length > 0) {
            artists = entity.artists.map((a) => a.name).filter(Boolean);
          } else if (entity.subtitle && itemType !== 'playlist' && itemType !== 'artist') {
            artists = [entity.subtitle.trim()];
          } else if (entity.trackList?.[0]?.subtitle && itemType === 'album') {
            artists = [entity.trackList[0].subtitle.trim()];
          }

          const artist = artists.join(', ') || undefined;
          const image = entity.visualIdentity?.image?.[0]?.url;
          const audio = entity.audioPreview?.url;
          const durationMs = entity.duration;

          return {
            id: targetId,
            title: rawTitle,
            cleanTitle: normalized.cleanTitle,
            artist,
            artists: artists.length > 0 ? artists : undefined,
            extraArtists: normalized.extraArtists,
            type: itemType,
            image,
            audio,
            durationMs,
          };
        }
      }
    } catch {
      // Fallback to oEmbed / OG scraper below
    }

    // 2. Try Spotify oEmbed endpoint
    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`;
      const oembed = await HttpClient.get<{
        title?: string;
        thumbnail_url?: string;
      }>(oembedUrl, { timeout: options?.timeout ?? 8000 });

      if (oembed?.title) {
        const normalized = normalizeSongTitle(oembed.title);
        return {
          id: targetId,
          title: oembed.title,
          cleanTitle: normalized.cleanTitle,
          extraArtists: normalized.extraArtists,
          type: itemType,
          image: oembed.thumbnail_url,
        };
      }
    } catch {
      // Fallback to OpenGraph scraper
    }

    // 3. Fallback to OpenGraph HTML Scraping
    let html = await HttpClient.get<string>(targetUrl, {
      timeout: options?.timeout ?? 8000,
      retries: options?.retries ?? 1,
    });

    if (SPOTIFY_LINK_MOBILE_REGEX.test(targetUrl)) {
      const desktopMatch = html.match(SPOTIFY_LINK_DESKTOP_REGEX)?.[0];
      if (desktopMatch) {
        targetUrl = desktopMatch;
        html = await HttpClient.get<string>(targetUrl, {
          timeout: options?.timeout ?? 8000,
          retries: options?.retries ?? 1,
        });
      }
    }

    const doc = getCheerioDoc(html);
    const title = metaTagContent(doc, 'og:title') || '';
    const description = metaTagContent(doc, 'og:description') || '';
    const image = metaTagContent(doc, 'og:image');
    const audio = metaTagContent(doc, 'og:audio');
    const ogType = metaTagContent(doc, 'og:type') || '';

    const type: MetadataType = targetUrl.includes('episode')
      ? 'podcast'
      : SPOTIFY_TYPE_MAP[ogType] || itemType;

    let artist: string | undefined;
    if (type === 'song' || type === 'album') {
      const artistMatch = description.match(/^([^·]+)\s+·/);
      artist = artistMatch?.[1]?.trim();
    }

    const cleanedTitle = title
      .replace(/(\s(?:–|-)\s.*?\s(?:by|von|de|par|di|door|av|af|przez)\s.+)?\s\|\sSpotify$/i, '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}·]/gu, '')
      .trim();

    const normalized = normalizeSongTitle(cleanedTitle);

    return {
      id: targetId,
      title: cleanedTitle,
      cleanTitle: normalized.cleanTitle,
      artist,
      extraArtists: normalized.extraArtists,
      description,
      type,
      image,
      audio,
    };
  }
}


