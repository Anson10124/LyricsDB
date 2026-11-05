"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import {
  CaseSensitive,
  HeadphoneOff,
  Headphones,
  Languages,
  LoaderCircle,
  Maximize,
  Pause,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { convertCompactToAmllLines } from "@/lib/lyrics-formatter";
import {
  fetchTrackNeighbors,
  fetchTrackPreview,
  type TrackNeighbors,
  type TrackPreview,
} from "@/lib/api-client";
import { prefetchTrackData } from "@/lib/track-data";
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

// Volume ramps at the edges of the preview clip so it doesn't cut in or out
const CLIP_FADE_IN_MS = 600;
const CLIP_FADE_OUT_MS = 2500;
// The clip stops just short of its end so the last decoded frame isn't heard
const CLIP_END_GUARD_MS = 100;

function clipVolume(position: number, clip: TrackPreview) {
  const out = (clip.endMs - CLIP_END_GUARD_MS - position) / CLIP_FADE_OUT_MS;
  // A clip from the very start of the song needs no fade in
  const into =
    clip.startMs > 0 ? (position - clip.startMs) / CLIP_FADE_IN_MS : 1;
  const gain = Math.min(1, Math.max(0, Math.min(out, into)));
  // Squared so the fade sounds even rather than dropping off at the end
  return gain * gain;
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

  // Switching songs keeps this component mounted, so restart playback for the
  // new track. Done during render so the new lyrics never get the old position.
  const [playbackTrackId, setPlaybackTrackId] = useState(track.id);
  if (playbackTrackId !== track.id) {
    setPlaybackTrackId(track.id);
    setCurrentTime(0);
    setIsPlaying(true);
  }
  // Re-anchor the timer before its next tick so it counts from 0 again
  useLayoutEffect(() => {
    playbackStartTimeRef.current = performance.now();
    playbackStartOffsetRef.current = 0;
  }, [track.id]);

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Audio preview: nothing is downloaded until the visitor turns it on. It
  // then stays on across track switches until turned off again.
  const canPreview = Boolean(track.neteaseId);
  const [audioOn, setAudioOn] = useState(false);
  // Downloaded clip, tagged with its track so a switch drops the old one
  const [preview, setPreview] = useState<
    (TrackPreview & { trackId: string }) | null
  >(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [previewStatus, setPreviewStatus] = useState<{
    trackId: string;
    state: "loading" | "none" | "failed";
  } | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const clip = audioOn && preview?.trackId === track.id ? preview : null;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const previewState = !audioOn
    ? "off"
    : clip
      ? "ready"
      : previewStatus?.trackId === track.id
        ? previewStatus.state
        : "loading";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Set when the visitor presses the button, so only that load reports back
  const announcePreviewRef = useRef(false);

  useEffect(() => {
    if (!audioOn || !canPreview || previewRef.current?.trackId === track.id) {
      return;
    }
    const trackId = track.id;
    const controller = new AbortController();
    setPreviewStatus({ trackId, state: "loading" });
    fetchTrackPreview(trackId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          if (result) URL.revokeObjectURL(result.url);
          return;
        }
        if (result) {
          // The notice is shown once the clip starts playing
          setPreview({ ...result, trackId });
          setPreviewStatus(null);
          return;
        }
        setPreviewStatus({ trackId, state: "none" });
        if (announcePreviewRef.current) {
          toast("No audio preview for this song");
        }
        announcePreviewRef.current = false;
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPreviewStatus({ trackId, state: "failed" });
        if (announcePreviewRef.current) {
          toast.error("Couldn't load the audio preview");
        }
        announcePreviewRef.current = false;
      });
    return () => controller.abort();
  }, [audioOn, canPreview, track.id, previewAttempt]);

  // Free the downloaded clip once it is replaced or the player goes away
  const previewUrl = preview?.url;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Starts, moves or stops the clip so it matches the lyrics position, fading
  // it at its edges. The clip only covers part of the song; outside it the
  // lyrics run on silently.
  const syncAudio = useCallback((position: number, playing: boolean) => {
    const audio = audioRef.current;
    const current = clipRef.current;
    if (!audio || !current) return;

    const inClip =
      position >= current.startMs &&
      position < current.endMs - CLIP_END_GUARD_MS;
    if (!playing || !inClip) {
      if (!audio.paused) audio.pause();
      return;
    }

    audio.volume = clipVolume(position, current);
    const target = (position - current.startMs) / 1000;
    if (Math.abs(audio.currentTime - target) > 0.25) {
      audio.currentTime = target;
    }
    if (audio.paused) {
      audio.play().catch((error: unknown) => {
        // Sound can't start before the visitor interacts with the page:
        // pause so their next press of Play starts everything together
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setIsPlaying(false);
        }
      });
    }
  }, []);

  const handleAudioError = useCallback(() => {
    setPreview(null);
    setPreviewStatus({ trackId: track.id, state: "failed" });
  }, [track.id]);

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
      syncAudio(currentTimeRef.current, false);
      return;
    }

    playbackStartTimeRef.current = performance.now();
    playbackStartOffsetRef.current = currentTimeRef.current;

    const intervalId = setInterval(() => {
      if (playbackStartTimeRef.current === null) return;
      const audio = audioRef.current;
      const current = clipRef.current;
      let nextTime: number;
      if (audio && current && !audio.paused) {
        // While the clip plays it is the clock, so the lyrics match what is
        // heard even when the audio buffers
        nextTime = current.startMs + audio.currentTime * 1000;
        playbackStartTimeRef.current = performance.now();
        playbackStartOffsetRef.current = nextTime;
      } else {
        const elapsed = performance.now() - playbackStartTimeRef.current;
        nextTime = playbackStartOffsetRef.current + elapsed;
      }
      syncAudio(nextTime, true);

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
  }, [isPlaying, durationMs, syncAudio]);

  // Flag a jump for one frame so AMLL drops any manual scroll and re-centres
  // on the new line instead of animating through everything in between
  const [isSeeking, setIsSeeking] = useState(false);
  useEffect(() => {
    if (!isSeeking) return;
    const frame = requestAnimationFrame(() => setIsSeeking(false));
    return () => cancelAnimationFrame(frame);
  }, [isSeeking]);

  const handleSeek = useCallback(
    (position: number) => {
      playbackStartTimeRef.current = performance.now();
      playbackStartOffsetRef.current = position;
      setIsSeeking(true);
      setCurrentTime(position);
      syncAudio(position, isPlayingRef.current);
    },
    [syncAudio],
  );

  // A freshly turned-on clip plays from its start unless the lyrics are
  // already inside it
  const startedClipRef = useRef<string | null>(null);
  useEffect(() => {
    if (!clip || startedClipRef.current === clip.url) return;
    startedClipRef.current = clip.url;
    const position = currentTimeRef.current;
    if (
      position < clip.startMs ||
      position >= clip.endMs - CLIP_FADE_OUT_MS
    ) {
      handleSeek(clip.startMs);
    }
    setIsPlaying(true);

    // Tell the visitor what they're hearing when they turn audio on
    if (announcePreviewRef.current) {
      announcePreviewRef.current = false;
      const seconds = Math.round((clip.endMs - clip.startMs) / 1000);
      toast(`This is only a ${seconds}-second preview`, {
        description:
          "Audio is powered by NetEase Cloud Music (163). The lyrics keep going silently after the preview ends.",
      });
    }
  }, [clip, handleSeek]);

  const handlePreviewButton = useCallback(() => {
    if (previewState === "failed") {
      announcePreviewRef.current = true;
      setPreviewStatus(null);
      setPreviewAttempt((n) => n + 1);
      return;
    }
    if (audioOn) {
      setAudioOn(false);
      startedClipRef.current = null;
    } else {
      announcePreviewRef.current = true;
      setAudioOn(true);
    }
  }, [audioOn, previewState]);

  const handleLineClick = useCallback(
    (event: LyricLineMouseEvent) => {
      const targetLine = lyricLines[event.lineIndex];
      if (targetLine?.startTime === undefined) return;
      handleSeek(targetLine.startTime);
      setIsPlaying(true);
    },
    [lyricLines, handleSeek],
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

  // The synced-lyrics tracks added just before and after this one
  const [neighbors, setNeighbors] = useState<TrackNeighbors | null>(null);
  // pushState instead of a router navigation: Next keeps the page mounted and
  // the track page follows the URL, so the fullscreen player just receives the
  // new song and animates to it. Back/forward still work through the URL.
  // At the oldest track there is nothing before it, so prev restarts instead.
  const moveTo = useCallback(
    (direction: "prev" | "next", around: TrackNeighbors) => {
      const target = around[direction];
      if (target) {
        // Further presses wait for the new track's neighbours
        setNeighbors(null);
        window.history.pushState(
          null,
          "",
          `/track/${encodeURIComponent(target)}`,
        );
      } else if (direction === "prev") {
        handleSeek(0);
      }
    },
    [handleSeek],
  );

  // A press that lands before this track's neighbours are known is replayed
  // once they arrive, so quick repeated presses aren't dropped
  const pendingMoveRef = useRef<"prev" | "next" | null>(null);

  useEffect(() => {
    let active = true;
    setNeighbors(null);
    fetchTrackNeighbors(track.id)
      .then((result) => {
        if (!active) return;
        setNeighbors(result);
        const pending = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (pending) moveTo(pending, result);
      })
      .catch(() => {
        pendingMoveRef.current = null;
      });
    return () => {
      active = false;
    };
  }, [track.id, moveTo]);

  // Loaded ahead while fullscreen is open so a switch is instant
  useEffect(() => {
    if (!isFullscreen || !neighbors) return;
    if (neighbors.prev) prefetchTrackData(neighbors.prev);
    if (neighbors.next) prefetchTrackData(neighbors.next);
  }, [isFullscreen, neighbors]);

  const handlePrevSong = useCallback(() => {
    if (neighbors) moveTo("prev", neighbors);
    else pendingMoveRef.current = "prev";
  }, [neighbors, moveTo]);

  const handleNextSong = useCallback(() => {
    if (neighbors) moveTo("next", neighbors);
    else pendingMoveRef.current = "next";
  }, [neighbors, moveTo]);

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
        {/* AMLL handles wheel/touch scrolling itself and springs back to the active line after a few seconds */}
        <div className="lyrics-mask lyrics-interactive relative z-10 h-full w-full overflow-hidden">
          <LyricPlayer
            lyricLines={lyricLines}
            currentTime={currentTime}
            isSeeking={isSeeking}
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
              <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover:h-1.5">
                {/* The stretch of the song the audio preview covers */}
                {clip && (
                  <div
                    className="absolute inset-y-0 rounded-full bg-white/40"
                    style={{
                      left: `${Math.min(100, (clip.startMs / durationMs) * 100)}%`,
                      width: `${Math.max(0, (Math.min(clip.endMs, durationMs) - clip.startMs) / durationMs) * 100}%`,
                    }}
                  />
                )}
                <div
                  className="relative h-full rounded-full bg-white/90"
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
          {canPreview && (
            <PillButton
              label={
                {
                  off: "Play audio preview",
                  loading: "Loading audio preview",
                  ready: "Turn off audio preview",
                  none: "No audio preview for this song",
                  failed: "Audio preview failed, press to retry",
                }[previewState]
              }
              onClick={handlePreviewButton}
              active={previewState === "ready" || previewState === "loading"}
            >
              {previewState === "loading" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : previewState === "none" || previewState === "failed" ? (
                <HeadphoneOff className="size-4" />
              ) : (
                <Headphones className="size-4" />
              )}
            </PillButton>
          )}
          <PillButton label="Fullscreen" onClick={handleOpenFullscreen}>
            <Maximize className="size-4" />
          </PillButton>
        </motion.div>
      </div>

      {clip && (
        <audio
          key={clip.url}
          ref={audioRef}
          src={clip.url}
          preload="auto"
          onError={handleAudioError}
          className="hidden"
        />
      )}

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
            onPrevSong={handlePrevSong}
            onNextSong={handleNextSong}
          />,
          document.body,
        )}
    </>
  );
}
