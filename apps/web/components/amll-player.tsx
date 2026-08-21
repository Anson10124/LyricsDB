"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Maximize, RotateCcw } from "lucide-react";
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

const AmllFullscreenPlayer = dynamic(
  () =>
    import("@/components/amll-fullscreen-player").then(
      (mod) => mod.AmllFullscreenPlayer,
    ),
  { ssr: false },
);

interface AmllPlayerProps {
  track: SanitizedTrack<TrackRecord>;
  rawLyrics: SyncedLyricsPayload;
}

export function AmllPlayer({ track, rawLyrics }: AmllPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const durationMs = track.durationMs || 180000;
  const lyricLines = useMemo(
    () => convertCompactToAmllLines(rawLyrics),
    [rawLyrics],
  );

  const playbackStartTimeRef = useRef<number | null>(null);
  const playbackStartOffsetRef = useRef<number>(0);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [isFullscreen]);

  // Main playback timer loop based on high-resolution performance.now()
  useEffect(() => {
    if (!isPlaying) {
      playbackStartTimeRef.current = null;
      return;
    }

    playbackStartTimeRef.current = performance.now();
    playbackStartOffsetRef.current = currentTime;

    const intervalId = setInterval(() => {
      if (playbackStartTimeRef.current === null) return;
      const elapsed = performance.now() - playbackStartTimeRef.current;
      const nextTime = playbackStartOffsetRef.current + elapsed;

      if (nextTime >= durationMs) {
        setCurrentTime(durationMs);
        setIsPlaying(false);
      } else {
        setCurrentTime(nextTime);
      }
    }, 50);

    return () => {
      clearInterval(intervalId);
    };
  }, [isPlaying, durationMs]);

  const handleLineClick = useCallback(
    (event: LyricLineMouseEvent) => {
      const targetLine = lyricLines[event.lineIndex];
      if (targetLine?.startTime !== undefined) {
        const newTime = targetLine.startTime;
        playbackStartTimeRef.current = performance.now();
        playbackStartOffsetRef.current = newTime;
        setCurrentTime(newTime);
      }
    },
    [lyricLines],
  );

  const handleOpenFullscreen = useCallback(() => {
    setIsFullscreen(true);
    try {
      if (
        !document.fullscreenElement &&
        document.documentElement.requestFullscreen
      ) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {
      // Fallback to overlay fullscreen
    }
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setIsFullscreen(false);
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch {
      // Fallback
    }
  }, []);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const handleSeek = useCallback((position: number) => {
    playbackStartTimeRef.current = performance.now();
    playbackStartOffsetRef.current = position;
    setCurrentTime(position);
  }, []);

  const handleRestart = useCallback(() => {
    playbackStartTimeRef.current = performance.now();
    playbackStartOffsetRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(true);
  }, []);

  if (!isClient) {
    return (
      <div className="flex h-[520px] w-full items-center justify-center rounded-2xl bg-card/60">
        <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="relative flex h-[520px] w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-foreground/5 text-white select-none font-[family-name:var(--font-inter)]">
        {(track.animatedArtwork?.squareVideoUrl ||
          track.animatedArtwork?.tallVideoUrl ||
          track.artworkUrl) && (
          <div className="absolute inset-0 z-0 opacity-70 pointer-events-none overflow-hidden">
            <BackgroundRender
              album={
                track.animatedArtwork?.squareVideoUrl ||
                track.animatedArtwork?.tallVideoUrl ||
                track.artworkUrl ||
                undefined
              }
              albumIsVideo={Boolean(
                track.animatedArtwork?.squareVideoUrl ||
                  track.animatedArtwork?.tallVideoUrl,
              )}
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

        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenFullscreen}
            className="flex size-9 items-center justify-center rounded-full backdrop-blur-md transition-all bg-black/15 hover:bg-black/30 hover:text-white cursor-pointer"
            title="Fullscreen"
          >
            <Maximize className="size-4" />
          </button>
        </div>

        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={handleRestart}
            className="flex size-9 items-center justify-center rounded-full backdrop-blur-md transition-all bg-black/15 hover:bg-black/30 hover:text-white cursor-pointer"
            title="Restart"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      </div>

      {isFullscreen && (
        <AmllFullscreenPlayer
          track={track}
          lyricLines={lyricLines}
          isPlaying={isPlaying}
          currentTime={currentTime}
          durationMs={durationMs}
          onClose={handleCloseFullscreen}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
        />
      )}
    </>
  );
}
