import type { FormattedLyricsResult, SupportedLyricFormat } from './lyrics.js';
import type { GetOrSyncTrackOptions, SanitizedTrack, TrackRecord } from './track.js';

export type StreamEventStage =
  | 'init'
  | 'cache_hit'
  | 'cache_miss'
  | 'resolving'
  | 'platform_matched'
  | 'lyrics_searching'
  | 'lyrics_found'
  | 'saving'
  | 'done'
  | 'error';

export interface ProgressLogEvent {
  stage: StreamEventStage;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface StreamLyricsOptions extends GetOrSyncTrackOptions {
  format?: SupportedLyricFormat | string;
  forceRefresh?: boolean;
}

export interface StreamLyricsDonePayload {
  track: SanitizedTrack<TrackRecord>;
  lyrics?: FormattedLyricsResult['content'];
  format?: string;
  contentType?: string;
}
