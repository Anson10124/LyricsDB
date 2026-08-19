import type { MetadataType, MusicParser, ResolveOptions, TrackMetadata } from '../types.js';
import { HttpClient } from '../utils/http.js';
import { cleanSearchQuery } from '../utils/query.js';
import { getCheerioDoc, metaTagContent } from '../utils/scraper.js';

export const SPOTIFY_LINK_REGEX =
  /^https:\/\/(open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)|spotify\.link)\/(\w{11,24})(?:[?#].*)?$/;
export const SPOTIFY_LINK_MOBILE_REGEX = /^https:\/\/spotify\.link\/(\w+)/;
export const SPOTIFY_LINK_DESKTOP_REGEX =
  /(https:\/\/open\.spotify\.com\/(track|album|playlist|artist|episode|show)\/(\w+))/;

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
  duration?: number;
  artists?: Array<{ name: string }>;
  audioPreview?: { url?: string };
  visualIdentity?: { image?: Array<{ url?: string }> };
}

export class SpotifyParser implements MusicParser {
  readonly id = 'spotify';
  readonly name = 'Spotify';

  match(url: string): boolean {
    return SPOTIFY_LINK_REGEX.test(url) || url.includes('open.spotify.com') || url.includes('spotify.link');
  }

  parse(url: string): { id: string; type?: MetadataType } {
    const match = url.match(SPOTIFY_LINK_REGEX);
    const id = match?.[3] || url.split('/').pop()?.split('?')[0] || '';
    const rawType = match?.[2];
    let type: MetadataType | undefined;
    if (rawType === 'track') type = 'song';
    else if (rawType === 'album') type = 'album';
    else if (rawType === 'playlist') type = 'playlist';
    else if (rawType === 'artist') type = 'artist';
    else if (rawType === 'episode') type = 'podcast';
    else if (rawType === 'show') type = 'show';

    return { id, type };
  }

  async fetchMetadata(id: string, url: string, options?: ResolveOptions): Promise<TrackMetadata> {
    const parsed = this.parse(url);
    const itemType = parsed.type || 'song';
    const singularPath = itemType === 'song' ? 'track' : itemType;

    // 1. Try Spotify Embed page (contains rich JSON data without any auth)
    try {
      const embedUrl = `https://open.spotify.com/embed/${singularPath}/${id}`;
      const embedHtml = await HttpClient.get<string>(embedUrl, {
        timeout: options?.timeout,
        retries: options?.retries,
      });

      const doc = getCheerioDoc(embedHtml);
      const nextDataText = doc('#__NEXT_DATA__').text();

      if (nextDataText) {
        const nextData = JSON.parse(nextDataText);
        const entity: SpotifyEmbedEntity | undefined = nextData.props?.pageProps?.state?.data?.entity;

        if (entity && (entity.name || entity.title)) {
          const title = (entity.name || entity.title || '').trim();
          const artist = entity.artists?.map((a) => a.name).join(', ') || undefined;
          const image = entity.visualIdentity?.image?.[0]?.url;
          const audio = entity.audioPreview?.url;
          const durationMs = entity.duration;

          return {
            id,
            title,
            artist,
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
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
      const oembed = await HttpClient.get<{
        title?: string;
        thumbnail_url?: string;
      }>(oembedUrl, { timeout: options?.timeout });

      if (oembed?.title) {
        return {
          id,
          title: oembed.title,
          type: itemType,
          image: oembed.thumbnail_url,
        };
      }
    } catch {
      // Fallback to OpenGraph scraper
    }

    // 3. Fallback to OpenGraph HTML Scraping
    let targetUrl = url;
    let html = await HttpClient.get<string>(targetUrl, {
      timeout: options?.timeout,
      retries: options?.retries,
    });

    if (SPOTIFY_LINK_MOBILE_REGEX.test(targetUrl)) {
      const desktopMatch = html.match(SPOTIFY_LINK_DESKTOP_REGEX)?.[0];
      if (desktopMatch) {
        targetUrl = desktopMatch;
        html = await HttpClient.get<string>(targetUrl, {
          timeout: options?.timeout,
          retries: options?.retries,
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
      : SPOTIFY_TYPE_MAP[ogType] || 'song';

    let artist: string | undefined;
    if (type === 'song' || type === 'album') {
      const artistMatch = description.match(/^([^·]+)\s+·/);
      artist = artistMatch?.[1]?.trim();
    }

    const cleanedTitle = title
      .replace(/(\s(?:–|-)\s.*?\s(?:by|von|de|par|di|door|av|af|przez)\s.+)?\s\|\sSpotify$/i, '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}·]/gu, '')
      .trim();

    return {
      id,
      title: cleanedTitle,
      artist,
      description,
      type,
      image,
      audio,
    };
  }

  buildSearchQuery(metadata: TrackMetadata): string {
    const title = metadata.title;
    const artist = metadata.artist;
    const raw = artist ? `${title} ${artist}` : title;
    return cleanSearchQuery(raw);
  }
}
