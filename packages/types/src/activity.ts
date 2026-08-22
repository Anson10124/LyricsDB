export interface ActivityTrackSummary {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string | null;
}

export interface ActivityEvent {
  id: string;
  type: "added";
  track: ActivityTrackSummary;
  timestamp: number;
}

export interface ActivityInitPayload {
  type: "init";
  totalTracks: number;
  timestamp: number;
}
