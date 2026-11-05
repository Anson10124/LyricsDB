"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import {
  CaseSensitive,
  Languages,
  Maximize,
  Pause,
  Play,
} from "lucide-react";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { convertCompactToAmllLines } from "@/lib/lyrics-formatter";
import { press, spring } from "@/lib/motion";
import "@applemusic-like-lyrics/core/style.css";

const LyricPlayer = dynamic(
  () => import("@applemusic-like-lyrics/react").then((mod) => mod.LyricPlayer),
  { ssr: false },
);

type LyricLineMouseEvent = Parameters<
  NonNullable<React.ComponentProps<typeof LyricPlayer>["onLyricLineClick"]>
>[0];

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
  // Lets the page react to playback (artwork scale, background flow)
  onPlayingChange?: (playing: boolean) => void;
}

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function PillButton({
  label,
  onClick,
  active = false,
  prominent = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  prominent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.06 }}
      whileTap={press}
      transition={spring.snappy}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className={`flex items-center justify-center rounded-full transition-colors cursor-pointer ${
        prominent
          ? "size-10 bg-white text-black hover:bg-white/90"
          : active
            ? "size-9 bg-white/25 text-white"
            : "size-9 text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </motion.button>
  );
}

export function AmllPlayer({
  track,
  rawLyrics,
  onPlayingChange,
}: AmllPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const [showTranslation, setShowTranslation] = useState(false);
  const [showRomaji, setShowRomaji] = useState(false);

  const durationMs = track.durationMs || 180000;
  const sourceLines = useMemo(
    () => convertCompactToAmllLines(rawLyrics),
    [rawLyrics],
  );
  const hasTranslation = useMemo(
    () => sourceLines.some((line) => line.translatedLyric),
    [sourceLines],
  );
  const hasRomaji = useMemo(
    () => sourceLines.some((line) => line.romanLyric),
    [sourceLines],
  );
  // The core LyricPlayer has no switch for these, so blank them out instead
  const lyricLines = useMemo(
    () =>
      sourceLines.map((line) => ({
        ...line,
        translatedLyric: showTranslation ? line.translatedLyric : "",
        romanLyric: showRomaji ? line.romanLyric : "",
      })),
    [sourceLines, showTranslation, showRomaji],
  );

  const playbackStartTimeRef = useRef<number | null>(null);
  const playbackStartOffsetRef = useRef<number>(0);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fullscreen has its own background, so the page one can rest meanwhile
  useEffect(() => {
    onPlayingChange?.(isPlaying && !isFullscreen);
  }, [isPlaying, isFullscreen, onPlayingChange]);

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
    playbackStartOffsetRef.current = currentTimeRef.current;

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

  const handleSeek = useCallback((position: number) => {
    playbackStartTimeRef.current = performance.now();
    playbackStartOffsetRef.current = position;
    setCurrentTime(position);
  }, []);

  const handleTogglePlay = useCallback(() => {
    // Pressing play after the track ended starts it over
    if (!isPlaying && currentTimeRef.current >= durationMs) {
      handleSeek(0);
    }
    setIsPlaying((prev) => !prev);
  }, [isPlaying, durationMs, handleSeek]);

  const progressPercent = Math.min(100, (currentTime / durationMs) * 100);

  if (!isClient) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
      </div>
    );
  }

  return (
    <>
      <div className="relative h-full w-full select-none overflow-hidden text-white font-[family-name:var(--font-inter)]">
        <div className="lyrics-mask relative z-10 h-full w-full overflow-hidden pointer-events-none">
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

        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring.smooth, delay: 0.35 }}
          className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 p-1 shadow-lg shadow-black/20 ring-1 ring-white/15 backdrop-blur-2xl"
        >
          <PillButton
            label={isPlaying ? "Pause" : "Play"}
            onClick={handleTogglePlay}
            prominent
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={isPlaying ? "pause" : "play"}
                initial={{ opacity: 0, scale: 0.5, rotate: -30 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.5, rotate: 30 }}
                transition={spring.snappy}
                className="flex"
              >
                {isPlaying ? (
                  <Pause className="size-4 fill-current" />
                ) : (
                  <Play className="size-4 translate-x-px fill-current" />
                )}
              </motion.span>
            </AnimatePresence>
          </PillButton>
          <div className="flex items-center gap-2 px-2 text-[11px] font-medium tabular-nums text-white/70">
            <span className="w-8 text-right">{formatTime(currentTime)}</span>
            {/* Drawn bar underneath, transparent native input on top for a tall hit area */}
            <div className="group relative flex h-6 w-24 items-center sm:w-44">
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover:h-1.5">
                <div
                  className="h-full rounded-full bg-white/90"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div
                className="pointer-events-none absolute size-3 rounded-full bg-white shadow transition-transform group-hover:scale-125 group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-white/50"
                style={{ left: `calc(${progressPercent}% - ${progressPercent * 0.12}px)` }}
              />
              <input
                type="range"
                min={0}
                max={durationMs}
                step={100}
                value={Math.min(currentTime, durationMs)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                aria-label="Seek"
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(durationMs)}`}
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
              />
            </div>
            <span className="w-8">{formatTime(durationMs)}</span>
          </div>
          {hasTranslation && (
            <PillButton
              label={showTranslation ? "Hide translation" : "Show translation"}
              onClick={() => setShowTranslation((prev) => !prev)}
              active={showTranslation}
            >
              <Languages className="size-4" />
            </PillButton>
          )}
          {hasRomaji && (
            <PillButton
              label={showRomaji ? "Hide romanization" : "Show romanization"}
              onClick={() => setShowRomaji((prev) => !prev)}
              active={showRomaji}
            >
              <CaseSensitive className="size-4" />
            </PillButton>
          )}
          <PillButton label="Fullscreen" onClick={handleOpenFullscreen}>
            <Maximize className="size-4" />
          </PillButton>
        </motion.div>
      </div>

      {/* Portaled so no ancestor stacking context (page header, grid) can sit above it */}
      {isFullscreen &&
        createPortal(
          <AmllFullscreenPlayer
            track={track}
            lyricLines={lyricLines}
            isPlaying={isPlaying}
            currentTime={currentTime}
            durationMs={durationMs}
            onClose={handleCloseFullscreen}
            onTogglePlay={handleTogglePlay}
            onSeek={handleSeek}
          />,
          document.body,
        )}
    </>
  );
}
