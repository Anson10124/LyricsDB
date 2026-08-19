import type { MatchCandidate, ResolvedLink } from '../types.js';
import { cleanSearchQuery } from './query.js';

export function compareTwoStrings(first: string, second: string): number {
  const firstClean = first.replace(/\s+/g, '');
  const secondClean = second.replace(/\s+/g, '');

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

  return (2.0 * intersectionSize) / (firstClean.length + secondClean.length - 2);
}

export function scoreMatch(candidateText: string, query: string): number {
  const normalizedCandidate = cleanSearchQuery(candidateText).toLowerCase();
  const normalizedQuery = cleanSearchQuery(query).toLowerCase();
  return compareTwoStrings(normalizedCandidate, normalizedQuery);
}

export const RESPONSE_COMPARE_MIN_SCORE = 0.7;
export const RESPONSE_COMPARE_MIN_INCLUSION_SCORE = 0.3;

export function findBestMatch(
  candidates: MatchCandidate[],
  query: string,
  platform: string
): { bestMatch: ResolvedLink | null; highestScore: number; matchedIndex: number } {
  let bestMatch: ResolvedLink | null = null;
  let highestScore = 0;
  let matchedIndex = -1;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const candidateText = [candidate.title, candidate.artist].filter(Boolean).join(' ');
    const score = scoreMatch(candidateText, query);

    if (score > highestScore) {
      highestScore = score;
      matchedIndex = i;
      bestMatch = {
        platform,
        url: candidate.url,
        id: candidate.id,
        isVerified: score >= RESPONSE_COMPARE_MIN_SCORE,
        notAvailable: score < RESPONSE_COMPARE_MIN_INCLUSION_SCORE,
        score,
      };
    }
  }

  return { bestMatch, highestScore, matchedIndex };
}
