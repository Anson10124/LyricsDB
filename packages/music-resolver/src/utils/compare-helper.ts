import { cleanSearchQuery } from './query.js';
import { tokenSortSimilarity } from './string-similarity.js';

export interface TrackMatchTarget {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
}

export interface CandidateTrack {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
}

export interface MatchScoreResult {
  score: number;
  isVerified: boolean;
  reason: string;
}

export function compareTracks(target: TrackMatchTarget, candidate: CandidateTrack): MatchScoreResult {
  if (!target || !candidate) {
    return { score: 0, isVerified: false, reason: 'Invalid parameters' };
  }

  const cleanTargetTitle = cleanSearchQuery(target.title);
  const cleanCandTitle = cleanSearchQuery(candidate.title);
  const titleScore = tokenSortSimilarity(cleanTargetTitle, cleanCandTitle);

  // If titles don't match well (< 0.4), match fails
  if (titleScore < 0.4) {
    return { score: titleScore * 0.5, isVerified: false, reason: 'Title mismatch' };
  }

  // Artist matching
  const targetArtists: string[] = (target.artists?.length ? target.artists : target.artist ? [target.artist] : [])
    .map((a: string) => cleanSearchQuery(a))
    .filter(Boolean);
  const candArtists: string[] = (candidate.artists?.length ? candidate.artists : candidate.artist ? [candidate.artist] : [])
    .map((a: string) => cleanSearchQuery(a))
    .filter(Boolean);

  let artistScore = 0;
  if (targetArtists.length > 0 && candArtists.length > 0) {
    let hits = 0;
    for (const ta of targetArtists) {
      for (const ca of candArtists) {
        if (tokenSortSimilarity(ta, ca) >= 0.7 || ta.includes(ca) || ca.includes(ta)) {
          hits++;
          break;
        }
      }
    }
    artistScore = hits / Math.max(targetArtists.length, 1);
  } else {
    artistScore = 0.5; // Neutral fallback if artist is missing
  }

  // Album matching (optional weight)
  let albumScore = 0.5;
  if (target.album && candidate.album) {
    albumScore = tokenSortSimilarity(cleanSearchQuery(target.album), cleanSearchQuery(candidate.album));
  }

  // Duration matching
  let durationScore = 1.0;
  let durDiffMs = 0;

  if (target.durationMs && candidate.durationMs && target.durationMs > 0 && candidate.durationMs > 0) {
    durDiffMs = Math.abs(target.durationMs - candidate.durationMs);
    if (durDiffMs <= 2000) {
      durationScore = 1.0;
    } else if (durDiffMs <= 5000) {
      durationScore = 0.8;
    } else if (durDiffMs <= 10000) {
      durationScore = 0.5;
    } else {
      durationScore = 0.1;
    }
  }

  // Weighted total score calculation
  // Title (45%), Artist (35%), Duration (15%), Album (5%)
  const totalScore = Math.min(
    1.0,
    titleScore * 0.45 + artistScore * 0.35 + durationScore * 0.15 + albumScore * 0.05
  );

  const isVerified = totalScore >= 0.82 && titleScore >= 0.7 && artistScore >= 0.6 && durationScore >= 0.5;
  const reason = isVerified
    ? `High confidence match (Score: ${totalScore.toFixed(2)})`
    : `Candidate score: ${totalScore.toFixed(2)}`;

  return {
    score: parseFloat(totalScore.toFixed(3)),
    isVerified,
    reason,
  };
}
