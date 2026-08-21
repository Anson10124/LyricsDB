import type {
  MatchCandidate,
  ResolvedLink,
  ScoreBreakdown,
  TrackMetadata,
} from "../types.js";
import {
  cleanSearchQuery,
  normalizeArtistName,
  normalizeSongTitle,
  splitArtists,
  type TitleNormalizationResult,
} from "./query.js";

export function compareTwoStrings(first: string, second: string): number {
  const firstClean = first.replace(/\s+/g, "");
  const secondClean = second.replace(/\s+/g, "");

  if (firstClean === secondClean) return 1;
  if (firstClean.length < 2 || secondClean.length < 2) return 0;

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < firstClean.length - 1; i++) {
    const bigram = firstClean.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram)! + 1 : 1;
    firstBigrams.set(bigram, count);
  }

  let intersectionSize = 0;
  for (let i = 0; i < secondClean.length - 1; i++) {
    const bigram = secondClean.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram)! : 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (
    (2.0 * intersectionSize) / (firstClean.length + secondClean.length - 2)
  );
}

// Levenshtein distance similarity (0.0 to 1.0)
export function levenshteinSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim();
  const s2 = str2.trim();
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  const distance = matrix[len1]![len2]!;
  const maxLen = Math.max(len1, len2);
  return Math.max(0, 1 - distance / maxLen);
}

// Token sort ratio: sorts tokens alphabetically to handle order differences (e.g. "A & B" vs "B & A")
export function tokenSortSimilarity(str1: string, str2: string): number {
  const tokens1 = cleanSearchQuery(str1)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
  const tokens2 = cleanSearchQuery(str2)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

  if (!tokens1 || !tokens2) return 0;
  if (tokens1 === tokens2) return 1;

  const dice = compareTwoStrings(tokens1, tokens2);
  const lev = levenshteinSimilarity(tokens1, tokens2);
  return Math.max(dice, lev);
}

export function scoreMatch(candidateText: string, query: string): number {
  const normalizedCandidate = cleanSearchQuery(candidateText).toLowerCase();
  const normalizedQuery = cleanSearchQuery(query).toLowerCase();
  const direct = compareTwoStrings(normalizedCandidate, normalizedQuery);
  const tokenSort = tokenSortSimilarity(normalizedCandidate, normalizedQuery);
  return Math.max(direct, tokenSort);
}

export const RESPONSE_COMPARE_MIN_SCORE = 0.7;
export const RESPONSE_COMPARE_MIN_INCLUSION_SCORE = 0.35;

export interface ScoredCandidateResult {
  candidate: MatchCandidate;
  score: number;
  breakdown: ScoreBreakdown;
  isVerified: boolean;
  notAvailable: boolean;
  matchReason: "isrc" | "fuzzy" | "direct";
}

export function calculateDurationScore(
  targetMs?: number,
  candidateMs?: number,
): { score: number; deltaMs?: number; penalty: number } {
  if (!targetMs || !candidateMs || targetMs <= 0 || candidateMs <= 0) {
    return { score: 1.0, penalty: 0 };
  }

  const deltaMs = Math.abs(targetMs - candidateMs);

  // Exact or nearly exact: within 3 seconds
  if (deltaMs <= 3000) {
    return { score: 1.0, deltaMs, penalty: 0 };
  }
  // Very close: within 7 seconds (tolerates standard mastering silence)
  if (deltaMs <= 7000) {
    const score = 1.0 - (deltaMs - 3000) / 10000;
    return { score, deltaMs, penalty: 0 };
  }
  // Moderate difference: 8s - 15s
  if (deltaMs <= 15000) {
    const score = 0.6 - (deltaMs - 7000) / 20000;
    return { score: Math.max(0.2, score), deltaMs, penalty: 0 };
  }
  // Big difference: 16s - 30s
  if (deltaMs <= 30000) {
    return { score: 0.1, deltaMs, penalty: 0.15 };
  }
  // Major mismatch (> 30s) -> Likely radio edit vs extended mix vs live vs wrong track
  const penalty = deltaMs > 60000 ? 0.6 : 0.35;
  return { score: 0, deltaMs, penalty };
}

export function scoreCandidate(
  candidate: MatchCandidate,
  target: TrackMetadata,
): ScoredCandidateResult {
  // 1. Exact ISRC Match -> Guaranteed 100% confidence
  if (target.isrc && candidate.isrc) {
    const targetIsrc = target.isrc.trim().toUpperCase();
    const candidateIsrc = candidate.isrc.trim().toUpperCase();
    if (targetIsrc === candidateIsrc) {
      const breakdown: ScoreBreakdown = {
        titleScore: 1,
        artistScore: 1,
        durationScore: 1,
        bonusScore: 0,
        penaltyScore: 0,
        finalScore: 1,
      };
      return {
        candidate,
        score: 1,
        breakdown,
        isVerified: true,
        notAvailable: false,
        matchReason: "isrc",
      };
    }
  }

  // 2. Title Normalization & Comparison
  const targetNorm: TitleNormalizationResult = normalizeSongTitle(target.title);
  const candidateNorm: TitleNormalizationResult = normalizeSongTitle(
    candidate.title,
  );

  const cleanTitleScore = tokenSortSimilarity(
    targetNorm.cleanTitle,
    candidateNorm.cleanTitle,
  );
  const rawTitleScore = tokenSortSimilarity(
    targetNorm.rawNormalized,
    candidateNorm.rawNormalized,
  );
  const titleScore = Math.max(cleanTitleScore, rawTitleScore);

  // 3. Artist Extraction & Comparison
  // Combine primary artist, explicit artists array, and extra extracted featured artists
  const targetArtists = [
    ...(target.artists || []),
    ...splitArtists(target.artist),
    ...targetNorm.extraArtists,
    ...(target.extraArtists || []),
  ]
    .map(normalizeArtistName)
    .filter(Boolean);

  const candidateArtists = [
    ...(candidate.artists || []),
    ...splitArtists(candidate.artist),
    ...candidateNorm.extraArtists,
    ...(candidate.aliases || []),
  ]
    .map(normalizeArtistName)
    .filter(Boolean);

  let artistScore = 0;

  if (targetArtists.length === 0 || candidateArtists.length === 0) {
    // If no artist info available, fallback to single query or neutral
    artistScore =
      target.artist && candidate.artist
        ? tokenSortSimilarity(target.artist, candidate.artist)
        : 0.8;
  } else {
    // Check overlap of artist tokens
    const targetSet = new Set(targetArtists);
    let matchedCount = 0;

    for (const cArtist of candidateArtists) {
      for (const tArtist of targetSet) {
        if (
          cArtist === tArtist ||
          cArtist.includes(tArtist) ||
          tArtist.includes(cArtist) ||
          compareTwoStrings(cArtist, tArtist) >= 0.8
        ) {
          matchedCount++;
          break;
        }
      }
    }

    const overlapScore =
      matchedCount /
      Math.max(1, Math.min(targetArtists.length, candidateArtists.length));
    const directJoinedScore = tokenSortSimilarity(
      targetArtists.join(" "),
      candidateArtists.join(" "),
    );
    artistScore = Math.max(overlapScore, directJoinedScore);
  }

  // 4. Duration Comparison
  const durationResult = calculateDurationScore(
    target.durationMs,
    candidate.durationMs,
  );
  const durationScore = durationResult.score;

  // 5. Penalties & Negative Keyword Filters
  let penaltyScore = durationResult.penalty;
  let bonusScore = 0;

  // Negative keyword filtering (Karaoke, Cover, Tribute, Instrumental)
  const isTargetSpecial =
    targetNorm.isKaraoke ||
    targetNorm.isCover ||
    targetNorm.isTribute ||
    targetNorm.isInstrumental;
  if (!isTargetSpecial) {
    if (
      candidateNorm.isKaraoke ||
      candidateNorm.isCover ||
      candidateNorm.isTribute
    ) {
      penaltyScore += 0.6; // Heavy disqualification for karaoke/tribute bands
    } else if (candidateNorm.isInstrumental && !targetNorm.isInstrumental) {
      penaltyScore += 0.4;
    }
  }

  // Version consistency check (Live vs Studio, Acoustic vs Studio)
  if (targetNorm.isLive !== candidateNorm.isLive) {
    penaltyScore += 0.3;
  } else if (targetNorm.isLive && candidateNorm.isLive) {
    bonusScore += 0.05;
  }

  if (targetNorm.isAcoustic !== candidateNorm.isAcoustic) {
    penaltyScore += 0.25;
  }

  // Album match bonus
  if (target.album && candidate.album) {
    const albumSim = tokenSortSimilarity(target.album, candidate.album);
    if (albumSim >= 0.8) {
      bonusScore += 0.05;
    }
  }

  // 6. Weighted Final Score Computation
  const hasDuration = Boolean(
    target.durationMs &&
    candidate.durationMs &&
    target.durationMs > 0 &&
    candidate.durationMs > 0,
  );

  let baseScore: number;
  if (hasDuration) {
    // 50% Title, 35% Artist, 15% Duration
    baseScore = 0.5 * titleScore + 0.35 * artistScore + 0.15 * durationScore;
  } else {
    // 60% Title, 40% Artist
    baseScore = 0.6 * titleScore + 0.4 * artistScore;
  }

  const finalScore = Math.max(
    0,
    Math.min(1, baseScore + bonusScore - penaltyScore),
  );

  const breakdown: ScoreBreakdown = {
    titleScore,
    artistScore,
    durationScore,
    bonusScore,
    penaltyScore,
    finalScore,
  };

  const isVerified =
    finalScore >= RESPONSE_COMPARE_MIN_SCORE &&
    titleScore >= 0.6 &&
    artistScore >= 0.4;
  const notAvailable = finalScore < RESPONSE_COMPARE_MIN_INCLUSION_SCORE;

  return {
    candidate,
    score: finalScore,
    breakdown,
    isVerified,
    notAvailable,
    matchReason: "fuzzy",
  };
}

export function findBestMatch(
  candidates: MatchCandidate[],
  query: string | TrackMetadata,
  platform: string,
): {
  bestMatch: ResolvedLink | null;
  highestScore: number;
  matchedIndex: number;
} {
  let bestMatch: ResolvedLink | null = null;
  let highestScore = 0;
  let matchedIndex = -1;

  // Convert raw string query to pseudo TrackMetadata if string was passed
  const target: TrackMetadata =
    typeof query === "string"
      ? { id: "query", title: query, type: "song" }
      : query;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const result = scoreCandidate(candidate, target);

    if (result.score > highestScore) {
      highestScore = result.score;
      matchedIndex = i;
      bestMatch = {
        platform,
        url: candidate.url,
        id: candidate.id,
        isVerified: result.isVerified,
        notAvailable: result.notAvailable,
        score: result.score,
        matchReason: result.matchReason,
        breakdown: result.breakdown,
        raw: candidate.raw,
      };
    }
  }

  return { bestMatch, highestScore, matchedIndex };
}
