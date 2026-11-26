"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Pause, Play } from "lucide-react";
import type { SyncedLyricsPayload } from "@repo/types";
import { convertCompactToAmllLines } from "@/lib/lyrics-formatter";
import "@applemusic-like-lyrics/core/style.css";

const LyricPlayer = dynamic(
  () => import("@applemusic-like-lyrics/react").then((mod) => mod.LyricPlayer),
  { ssr: false },
);

type LyricLineMouseEvent = Parameters<
  NonNullable<React.ComponentProps<typeof LyricPlayer>["onLyricLineClick"]>
>[0];

// Playback starts this long before the first line, so the intro isn't waited out
const LEAD_IN_MS = 2000;

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// A silent, lyrics-only player for checking an edit before it is saved
export function LyricsPreview({
  lyrics,
  durationMs: trackDurationMs,
}: {
  lyrics: SyncedLyricsPayload;
  durationMs?: number | null;
}) {
  const lyricLines = useMemo(() => convertCompactToAmllLines(lyrics), [lyrics]);
  const firstStart = lyricLines[0]?.startTime ?? 0;
  const lastEnd = lyricLines.reduce((max, line) => Math.max(max, line.endTime), 0);
  // Edits can push lines past the stored duration, so the bar always covers them
  const durationMs = Math.max(trackDurationMs || 0, lastEnd + LEAD_IN_MS);

  const [currentTime, setCurrentTime] = useState(() =>
    Math.max(0, firstStart - LEAD_IN_MS),
  );
  const [isPlaying, setIsPlaying] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  // Clock based on performance.now(), re-anchored on every play and seek
  const anchorRef = useRef({ at: 0, position: 0 });
  useEffect(() => {
    if (!isPlaying) return;
    anchorRef.current = { at: performance.now(), position: currentTimeRef.current };
    const id = setInterval(() => {
      const { at, position } = anchorRef.current;
      const next = position + performance.now() - at;
      if (next >= durationMs) {
        setCurrentTime(durationMs);
        setIsPlaying(false);
      } else {
        setCurrentTime(next);
      }
    }, 50);
    return () => clearInterval(id);
  }, [isPlaying, durationMs]);

  // Flag a jump for one frame so AMLL re-centres instead of scrolling through
  useEffect(() => {
    if (!isSeeking) return;
    const frame = requestAnimationFrame(() => setIsSeeking(false));
    return () => cancelAnimationFrame(frame);
  }, [isSeeking]);

  const seek = useCallback((position: number) => {
    anchorRef.current = { at: performance.now(), position };
    setIsSeeking(true);
    setCurrentTime(position);
  }, []);

  const handleLineClick = useCallback(
    (event: LyricLineMouseEvent) => {
      const line = lyricLines[event.lineIndex];
      if (line?.startTime === undefined) return;
      seek(line.startTime);
      setIsPlaying(true);
    },
    [lyricLines, seek],
  );

  const togglePlay = () => {
    // Pressing play at the end starts over
    if (!isPlaying && currentTimeRef.current >= durationMs) {
      seek(Math.max(0, firstStart - LEAD_IN_MS));
    }
    setIsPlaying((prev) => !prev);
  };

  const progress = Math.min(100, (currentTime / durationMs) * 100);

  return (
    <div className="relative h-full w-full select-none overflow-hidden font-[family-name:var(--font-inter)] text-white">
      <div className="lyrics-mask lyrics-interactive h-full w-full overflow-hidden">
        <LyricPlayer
          lyricLines={lyricLines}
          currentTime={currentTime}
          isSeeking={isSeeking}
          playing={isPlaying}
          alignAnchor="center"
          alignPosition={0.4}
          enableSpring
          enableBlur
          enableScale
          wordFadeWidth={0.8}
          onLyricLineClick={handleLineClick}
          className="h-full w-full"
        />
      </div>

      <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 p-1 ring-1 ring-white/15">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause preview" : "Play preview"}
          className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/90"
        >
          {isPlaying ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 translate-x-px fill-current" />
          )}
        </button>
        <div className="flex items-center gap-2 px-2 text-[11px] font-medium tabular-nums text-white/70">
          <span className="w-8 text-right">{formatTime(currentTime)}</span>
          <div className="group relative flex h-6 w-28 items-center sm:w-56">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white/90"
                style={{ width: `${progress}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={durationMs}
              step={100}
              value={Math.min(currentTime, durationMs)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek preview"
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(durationMs)}`}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
            />
          </div>
          <span className="w-8">{formatTime(durationMs)}</span>
        </div>
      </div>
    </div>
  );
}
