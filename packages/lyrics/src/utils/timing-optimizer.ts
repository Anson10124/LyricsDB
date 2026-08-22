import type {
  CompactLyricLine,
  CompactLyricWord,
  SyncedLyricsPayload,
  VocalType,
} from "@repo/types";

export interface OptimizeTimingOptions {
  /**
   * Clean up accidental line overlaps (<= 100ms or <= 10% of following line duration)
   * while preserving intentional vocal overlaps (>= 500ms or > 100ms and > 10%).
   * @default true
   */
  cleanUnintentionalOverlaps?: boolean;

  /**
   * Synchronize the timing window between main lead lines and their attached background lines.
   * @default true
   */
  syncMainAndBackgroundLines?: boolean;

  /**
   * Ensure background lines do not appear as the first line and do not have consecutive background lines.
   * Converts invalid background lines into lead lines.
   * @default true
   */
  convertExcessiveBackgroundLines?: boolean;

  /**
   * Advance start times by up to 600ms (or 400ms for overlapping lines) for display animation.
   * @default false
   */
  tryAdvanceStartTime?: boolean;
}

const DEFAULT_TIMING_OPTIONS: Required<OptimizeTimingOptions> = {
  cleanUnintentionalOverlaps: true,
  syncMainAndBackgroundLines: true,
  convertExcessiveBackgroundLines: true,
  tryAdvanceStartTime: false,
};

export function getLineWords(line: CompactLyricLine): CompactLyricWord[] {
  return line.filter((item): item is CompactLyricWord => Array.isArray(item));
}

export function getLineStringTokens(line: CompactLyricLine): string[] {
  return line.filter((item): item is string => typeof item === "string");
}

export function isBackgroundVocal(vocalType: VocalType): boolean {
  return vocalType === 2 || vocalType === 4;
}

export function isLineBackground(words: CompactLyricWord[]): boolean {
  if (words.length === 0) return false;
  return isBackgroundVocal(words[0]![0]);
}

export function getLeadVocalType(vocalType: VocalType): VocalType {
  if (vocalType === 4) return 3; // Duet BG -> Duet Lead
  if (vocalType === 2) return 1; // Main BG -> Main Lead
  return vocalType;
}

export function getLineStartMs(words: CompactLyricWord[]): number {
  if (words.length === 0) return 0;
  return words[0]![1];
}

export function getLineEndMs(words: CompactLyricWord[]): number {
  if (words.length === 0) return 0;
  const last = words[words.length - 1]!;
  return last[1] + (last[2] || 0);
}

function clonePayload(payload: SyncedLyricsPayload): SyncedLyricsPayload {
  return payload.map((line) =>
    line.map((item) => (Array.isArray(item) ? [...item] : item)),
  );
}

function clampLineEndMs(words: CompactLyricWord[], targetEndMs: number): void {
  if (words.length === 0) return;

  for (let idx = words.length - 1; idx >= 0; idx--) {
    const word = words[idx]!;
    const wordStart = word[1];
    const wordEnd = wordStart + (word[2] || 0);

    if (wordStart >= targetEndMs) {
      word[2] = 0;
    } else if (wordEnd > targetEndMs) {
      word[2] = Math.max(0, targetEndMs - wordStart);
    }
  }
}

/**
 * Ensures background vocals are not orphan at index 0 and converts consecutive background
 * vocal lines into lead vocal lines.
 */
export function convertExcessiveBackgroundLines(
  payload: SyncedLyricsPayload,
): SyncedLyricsPayload {
  const result = clonePayload(payload);
  let consecutiveBgCount = 0;

  for (let i = 0; i < result.length; i++) {
    const line = result[i]!;
    const words = getLineWords(line);
    if (words.length === 0) continue;

    const isBg = isLineBackground(words);

    if (isBg) {
      consecutiveBgCount++;
      if (i === 0 || consecutiveBgCount > 1) {
        for (const w of words) {
          w[0] = getLeadVocalType(w[0]);
        }
      }
    } else {
      consecutiveBgCount = 0;
    }
  }

  return result;
}

/**
 * Synchronizes the start and end bounding window between a main line and its attached background line.
 */
export function syncMainAndBackgroundLines(
  payload: SyncedLyricsPayload,
): SyncedLyricsPayload {
  const result = clonePayload(payload);

  for (let i = result.length - 2; i >= 0; i--) {
    const line = result[i]!;
    const words = getLineWords(line);
    if (words.length === 0 || isLineBackground(words)) continue;

    const nextLine = result[i + 1]!;
    const nextWords = getLineWords(nextLine);
    if (nextWords.length === 0 || !isLineBackground(nextWords)) continue;

    const mainStart = getLineStartMs(words);
    const mainEnd = getLineEndMs(words);
    const bgStart = getLineStartMs(nextWords);
    const bgEnd = getLineEndMs(nextWords);

    const finalStart = Math.min(mainStart, bgStart);
    const finalEnd = Math.max(mainEnd, bgEnd);

    if (mainStart > finalStart && words.length > 0) {
      const first = words[0]!;
      const diff = first[1] - finalStart;
      first[1] = finalStart;
      first[2] = (first[2] || 0) + diff;
    }

    if (bgStart > finalStart && nextWords.length > 0) {
      const first = nextWords[0]!;
      const diff = first[1] - finalStart;
      first[1] = finalStart;
      first[2] = (first[2] || 0) + diff;
    }

    // If main line ends before finalEnd, extend the duration of the last word
    if (mainEnd < finalEnd && words.length > 0) {
      const last = words[words.length - 1]!;
      last[2] = Math.max(0, finalEnd - last[1]);
    }

    // If background line ends before finalEnd, extend the duration of the last background word
    if (bgEnd < finalEnd && nextWords.length > 0) {
      const last = nextWords[nextWords.length - 1]!;
      last[2] = Math.max(0, finalEnd - last[1]);
    }
  }

  return result;
}

/**
 * Cleans unintentional overlaps (overlap <= 100ms or <= 10% of following line duration)
 * while preserving intentional overlaps (>= 500ms or > 100ms and > 10%).
 */
export function cleanUnintentionalOverlaps(
  payload: SyncedLyricsPayload,
  syncBackgroundLines = true,
): SyncedLyricsPayload {
  const result = clonePayload(payload);

  for (let i = 0; i < result.length - 1; i++) {
    const line = result[i]!;
    const words = getLineWords(line);
    if (words.length === 0 || isLineBackground(words)) continue;

    for (let j = i + 1; j < result.length; j++) {
      const nextLine = result[j]!;
      const nextWords = getLineWords(nextLine);
      if (nextWords.length === 0 || isLineBackground(nextWords)) continue;

      const lineEnd = getLineEndMs(words);
      const nextStart = getLineStartMs(nextWords);
      const overlap = lineEnd - nextStart;

      if (overlap <= 0) {
        break;
      }

      const nextDuration = getLineEndMs(nextWords) - nextStart;
      const percentageThreshold = nextDuration * 0.1;

      const isIntentionalOverlap =
        overlap >= 500 || (overlap > 100 && overlap > percentageThreshold);

      if (!isIntentionalOverlap) {
        clampLineEndMs(words, nextStart);

        if (syncBackgroundLines && i + 1 < result.length) {
          const attachedBgLine = result[i + 1]!;
          const attachedBgWords = getLineWords(attachedBgLine);
          if (isLineBackground(attachedBgWords)) {
            clampLineEndMs(attachedBgWords, nextStart);
          }
        }
        break;
      }
    }
  }

  return result;
}

/**
 * Advances start times by up to 600ms (gap) or 400ms (overlap) for smooth visual display lead-in.
 */
export function tryAdvanceStartTime(
  payload: SyncedLyricsPayload,
  syncBackgroundLines = true,
): SyncedLyricsPayload {
  const result = clonePayload(payload);

  const defaultAdvanceAmount = 600;
  const fallbackAdvanceAmount = 400;
  const fallbackAdvanceRatio = 0.7;

  let prevLineStartTime = 0;
  let prevLineEndTime = 0;
  let prevMainGroupStartTime = 0;
  let prevMainGroupEndTime = 0;
  let hasPrevLine = false;

  for (let i = 0; i < result.length; i++) {
    const line = result[i]!;
    const words = getLineWords(line);
    if (words.length === 0 || isLineBackground(words)) continue;

    const originalStartTime = getLineStartMs(words);
    const originalEndTime = getLineEndMs(words);

    let targetAdvanceAmount = 0;
    let safeBoundary = 0;

    if (hasPrevLine) {
      const originallyHadGap = originalStartTime >= prevLineEndTime;

      if (originallyHadGap) {
        targetAdvanceAmount = defaultAdvanceAmount;
        safeBoundary = prevMainGroupEndTime;
      } else {
        const overlapDuration = prevLineEndTime - originalStartTime;
        if (overlapDuration < fallbackAdvanceAmount) {
          targetAdvanceAmount = overlapDuration * fallbackAdvanceRatio;
        } else {
          targetAdvanceAmount = fallbackAdvanceAmount;
        }
        safeBoundary = prevLineStartTime;
      }
    } else {
      targetAdvanceAmount = defaultAdvanceAmount;
      safeBoundary = 0;
    }

    const targetTime = originalStartTime - targetAdvanceAmount;
    const newStartTime = Math.max(safeBoundary, Math.round(targetTime));

    if (newStartTime < originalStartTime && words.length > 0) {
      const firstWord = words[0]!;
      const diff = firstWord[1] - newStartTime;
      firstWord[1] = newStartTime;
      firstWord[2] = (firstWord[2] || 0) + diff;
    }

    const nextLine = result[i + 1];
    if (syncBackgroundLines && nextLine) {
      const nextWords = getLineWords(nextLine);
      if (isLineBackground(nextWords) && nextWords.length > 0) {
        const firstBgWord = nextWords[0]!;
        if (newStartTime < firstBgWord[1]) {
          const diff = firstBgWord[1] - newStartTime;
          firstBgWord[1] = newStartTime;
          firstBgWord[2] = (firstBgWord[2] || 0) + diff;
        }
      }
    }

    if (hasPrevLine) {
      const overlapsPrevGroup =
        originalStartTime < prevMainGroupEndTime &&
        originalEndTime > prevMainGroupStartTime;

      if (overlapsPrevGroup) {
        prevMainGroupStartTime = Math.min(
          prevMainGroupStartTime,
          originalStartTime,
        );
        prevMainGroupEndTime = Math.max(prevMainGroupEndTime, originalEndTime);
      } else {
        prevMainGroupStartTime = originalStartTime;
        prevMainGroupEndTime = originalEndTime;
      }
    } else {
      prevMainGroupStartTime = originalStartTime;
      prevMainGroupEndTime = originalEndTime;
    }

    prevLineStartTime = words.length > 0 ? words[0]![1] : originalStartTime;
    prevLineEndTime = originalEndTime;
    hasPrevLine = true;
  }

  return result;
}

/**
 * Optimizes the timing and structure of synced lyrics.
 */
export function optimizeTiming(
  payload: SyncedLyricsPayload,
  options?: OptimizeTimingOptions,
): SyncedLyricsPayload {
  const config = { ...DEFAULT_TIMING_OPTIONS, ...options };
  let result = payload;

  if (config.convertExcessiveBackgroundLines) {
    result = convertExcessiveBackgroundLines(result);
  }
  if (config.syncMainAndBackgroundLines) {
    result = syncMainAndBackgroundLines(result);
  }
  if (config.cleanUnintentionalOverlaps) {
    result = cleanUnintentionalOverlaps(
      result,
      config.syncMainAndBackgroundLines,
    );
  }
  if (config.tryAdvanceStartTime) {
    result = tryAdvanceStartTime(result, config.syncMainAndBackgroundLines);
  }

  return result;
}
