"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Play, Pause, RotateCcw } from "lucide-react";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { convertCompactToAmllLines } from "@/lib/lyrics-formatter";
import "@applemusic-like-lyrics/core/style.css";

const LyricPlayer = dynamic(
  () => import("@applemusic-like-lyrics/react").then((mod) => mod.LyricPlayer),
  { ssr: false },
);

type LyricLineMouseEvent = Parameters<
  NonNullable<React.ComponentProps<typeof LyricPlayer>["onLyricLineClick"]>
>[0];

const BackgroundRender = dynamic(
  () =>
    import("@applemusic-like-lyrics/react").then((mod) => mod.BackgroundRender),
  { ssr: false },
);

interface AmllPlayerProps {
  track: SanitizedTrack<TrackRecord>;
  rawLyrics: SyncedLyricsPayload;
}

export function AmllPlayer({ track, rawLyrics }: AmllPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isClient, setIsClient] = useState(false);

  const durationMs = track.durationMs || 180000;
  const lyricLines = useMemo(
    () => convertCompactToAmllLines(rawLyrics),
    [rawLyrics],
  );

  const lastFrameTimeRef = useRef<number | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = null;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      return;
    }

    const onFrame = (now: number) => {
      if (lastFrameTimeRef.current !== null) {
        const delta = now - lastFrameTimeRef.current;
        setCurrentTime((prev) => {
          const next = prev + delta;
          if (next >= durationMs) {
            setIsPlaying(false);
            return durationMs;
          }
          return next;
        });
      }
      lastFrameTimeRef.current = now;
      animFrameIdRef.current = requestAnimationFrame(onFrame);
    };

    animFrameIdRef.current = requestAnimationFrame(onFrame);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [isPlaying, durationMs]);

  const handleLineClick = (event: LyricLineMouseEvent) => {
    const targetLine = lyricLines[event.lineIndex];
    if (targetLine?.startTime !== undefined) {
      setCurrentTime(targetLine.startTime);
      lastFrameTimeRef.current = null;
    }
  };

  if (!isClient) {
    return (
      <div className="flex h-[520px] w-full items-center justify-center rounded-2xl bg-card/60">
        <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex h-[520px] w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-foreground/5 text-white select-none font-[family-name:var(--font-inter)]">
      {track.artworkUrl && (
        <div className="absolute inset-0 z-0 opacity-70 pointer-events-none overflow-hidden">
          <BackgroundRender
            album={track.artworkUrl}
            playing={isPlaying}
            fps={60}
            flowSpeed={1}
          />
        </div>
      )}

      <div className="relative z-10 h-full w-full overflow-hidden px-4 sm:px-6">
        <LyricPlayer
          lyricLines={lyricLines}
          currentTime={currentTime}
          playing={isPlaying}
          alignAnchor="center"
          alignPosition={0.4}
          enableSpring={true}
          enableBlur={true}
          enableScale={true}
          wordFadeWidth={0.8}
          onLyricLineClick={handleLineClick}
          className="h-full w-full"
        />
      </div>

      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setCurrentTime(0);
            lastFrameTimeRef.current = null;
          }}
          className="flex size-9 items-center justify-center rounded-full backdrop-blur-md transition-all bg-black/15 hover:bg-black/30 hover:text-white cursor-pointer"
          title="Restart"
        >
          <RotateCcw className="size-4" />
        </button>

        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          className="flex size-9 items-center justify-center rounded-full backdrop-blur-md transition-all bg-black/15 hover:bg-black/30 hover:text-white cursor-pointer"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
