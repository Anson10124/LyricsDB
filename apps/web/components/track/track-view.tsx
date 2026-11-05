"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  BadgeCheck,
  CircleCheck,
  ExternalLink,
  FileDown,
  Music2,
  RefreshCw,
} from "lucide-react";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { resolveTrackArtwork } from "@/lib/artwork";
import { uniqueArtists } from "@/lib/utils";
import { press, rise, spring, stagger } from "@/lib/motion";
import { AmllPlayer } from "@/components/amll-player";
import { TrackBackground } from "@/components/track/track-background";
import { ExportSheet } from "@/components/track/export-sheet";

interface TrackViewProps {
  track: SanitizedTrack<TrackRecord>;
  rawLyrics?: SyncedLyricsPayload | string | null;
  onBack?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onMarkCorrect?: () => void;
  isMarkingCorrect?: boolean;
}

const glassButton =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white/10 text-sm font-medium text-white/85 ring-1 ring-white/15 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

function PlatformLinks({ track }: { track: SanitizedTrack<TrackRecord> }) {
  const links = [
    track.spotifyId && {
      label: "Spotify",
      href: `https://open.spotify.com/track/${track.spotifyId}`,
    },
    track.appleMusicId && {
      label: "Apple Music",
      href: `https://music.apple.com/song/${track.appleMusicId}`,
    },
    track.deezerId && {
      label: "Deezer",
      href: `https://www.deezer.com/track/${track.deezerId}`,
    },
  ].filter(Boolean) as { label: string; href: string }[];

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((link) => (
        <motion.a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          whileTap={press}
          transition={spring.snappy}
          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/75 transition-colors hover:bg-white/20 hover:text-white"
        >
          {link.label}
          <ExternalLink className="size-3" />
        </motion.a>
      ))}
    </div>
  );
}

/**
 * The cover art. Plays the Apple Music animated cover when the track has one
 * (muted, looping, paused along with playback), otherwise the still image.
 */
function TrackCover({
  imageCover,
  videoCover,
  playing,
  alt,
}: {
  imageCover?: string;
  videoCover?: string;
  playing: boolean;
  alt: string;
}) {
  const reduceMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = Boolean(videoCover) && !videoFailed && !reduceMotion;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) {
      video.pause();
      return;
    }
    // Autoplay can be refused (e.g. battery saver); the poster stays visible
    const resume = () => {
      if (document.visibilityState === "visible") video.play().catch(() => {});
    };
    resume();
    // Browsers pause muted videos on hidden tabs; pick up again on return
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [playing, showVideo]);

  if (showVideo) {
    return (
      <video
        ref={videoRef}
        key={videoCover}
        src={videoCover}
        poster={imageCover}
        aria-label={alt}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onError={() => setVideoFailed(true)}
        className="size-full object-cover"
      />
    );
  }

  if (imageCover) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={imageCover}
        src={imageCover}
        alt={alt}
        // Fades in once decoded instead of popping in line by line
        onLoad={(e) => (e.currentTarget.style.opacity = "1")}
        style={{ opacity: 0 }}
        className="size-full object-cover transition-opacity duration-700 ease-out"
      />
    );
  }

  return (
    <div className="flex size-full items-center justify-center text-white/50">
      <Music2 className="size-1/3" />
    </div>
  );
}

function PlainLyrics({ text }: { text: string }) {
  return (
    <div className="lyrics-mask h-full overflow-y-auto px-2 py-[18%]">
      <p className="whitespace-pre-line text-2xl font-semibold leading-snug text-white/85 sm:text-3xl font-[family-name:var(--font-inter)]">
        {text}
      </p>
    </div>
  );
}

function NoLyrics() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/60">
      <Music2 className="size-10" />
      <p className="text-sm font-medium">
        We couldn&apos;t find lyrics for this track.
      </p>
    </div>
  );
}

export function TrackView({
  track,
  rawLyrics,
  onBack,
  onRefresh,
  isRefreshing = false,
  onMarkCorrect,
  isMarkingCorrect = false,
}: TrackViewProps) {
  const [playing, setPlaying] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const { imageCover, videoCover } = resolveTrackArtwork(track.artwork, 1000);
  const artistLine =
    uniqueArtists(track.artists).join(", ") || "Unknown Artist";
  const isSynced = Array.isArray(rawLyrics);
  // TTML strings have no player here; the sheet shows them as code
  const plainText =
    typeof rawLyrics === "string" && !rawLyrics.trim().startsWith("<")
      ? rawLyrics
      : null;

  return (
    <div className="dark relative h-svh overflow-hidden text-white">
      <TrackBackground
        imageCover={imageCover}
        videoCover={videoCover}
        playing={playing}
      />

      {/* Fixed to one screen: details take what they need, lyrics fill the rest */}
      <div className="relative z-10 mx-auto grid h-full w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-6 px-5 pt-24 pb-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:grid-rows-1 lg:gap-14 lg:pb-8">
        {/* Left: artwork and details */}
        <motion.aside
          variants={stagger(0.06, 0.1)}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-5 lg:justify-center"
        >
          {onBack && (
            <motion.button
              variants={rise}
              type="button"
              onClick={onBack}
              whileTap={press}
              className={`${glassButton} w-fit px-3.5 py-1.5 text-xs`}
            >
              <ArrowLeft className="size-3.5" />
              Search another song
            </motion.button>
          )}

          <div className="flex items-center gap-4 lg:flex-col lg:items-stretch lg:gap-6">
            {/* Apple Music-style: the cover recedes when playback pauses */}
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 16 }}
              animate={{ opacity: 1, scale: playing ? 1 : 0.9, y: 0 }}
              transition={{ ...spring.soft, opacity: { duration: 0.6 } }}
              className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-xl bg-white/10 shadow-2xl shadow-black/40 ring-1 ring-white/10 sm:w-32 lg:w-full lg:rounded-2xl"
            >
              <TrackCover
                imageCover={imageCover}
                videoCover={videoCover}
                playing={playing}
                alt={track.album || track.title}
              />
            </motion.div>

            <motion.div variants={rise} className="flex min-w-0 flex-col gap-1">
              <h1
                className="line-clamp-2 text-2xl font-bold leading-tight tracking-tight text-balance sm:text-3xl"
                title={track.title}
              >
                {track.title}
              </h1>
              <p className="truncate text-base font-medium text-white/75 sm:text-lg">
                {artistLine}
              </p>
            </motion.div>
          </div>

          <motion.div variants={rise}>
            <PlatformLinks track={track} />
          </motion.div>

          <motion.div
            variants={rise}
            className="flex flex-wrap items-center gap-2"
          >
            <motion.button
              type="button"
              onClick={() => setSheetOpen(true)}
              whileHover={{ scale: 1.03 }}
              whileTap={press}
              transition={spring.snappy}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-black/20 transition-colors hover:bg-white/90 cursor-pointer"
            >
              <FileDown className="size-4" />
              Get lyrics
            </motion.button>

            {onMarkCorrect &&
              (track.isVerified ? (
                <span
                  title="This track has been confirmed correct"
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-2 text-sm font-medium text-emerald-300 ring-1 ring-emerald-300/25 backdrop-blur-xl"
                >
                  <BadgeCheck className="size-4" />
                  Verified
                </span>
              ) : (
                <motion.button
                  type="button"
                  onClick={onMarkCorrect}
                  disabled={isMarkingCorrect || isRefreshing}
                  whileTap={press}
                  transition={spring.snappy}
                  title="Confirm this track's metadata and lyrics are correct"
                  className={`${glassButton} px-3.5 py-2`}
                >
                  <CircleCheck
                    className={`size-4 ${isMarkingCorrect ? "animate-pulse" : ""}`}
                  />
                  {isMarkingCorrect ? "Verifying…" : "Mark as correct"}
                </motion.button>
              ))}

            {onRefresh && !track.isVerified && (
              <motion.button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing || isMarkingCorrect}
                whileTap={press}
                transition={spring.snappy}
                aria-label="Refresh from upstream providers"
                title="Re-fetch this track from upstream providers"
                className={`${glassButton} size-9`}
              >
                <RefreshCw
                  className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </motion.button>
            )}
          </motion.div>
        </motion.aside>

        {/* Right: lyrics */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.soft, delay: 0.2 }}
          aria-label="Lyrics"
          className="relative h-full min-h-0"
        >
          {isSynced ? (
            <AmllPlayer
              track={track}
              rawLyrics={rawLyrics as SyncedLyricsPayload}
              onPlayingChange={setPlaying}
            />
          ) : plainText ? (
            <PlainLyrics text={plainText} />
          ) : rawLyrics ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-white/70">
              <p className="text-sm">
                These lyrics are only available as a file.
              </p>
              <motion.button
                type="button"
                onClick={() => setSheetOpen(true)}
                whileTap={press}
                className={`${glassButton} px-4 py-2`}
              >
                <FileDown className="size-4" />
                Open lyrics
              </motion.button>
            </div>
          ) : (
            <NoLyrics />
          )}
        </motion.section>
      </div>

      <ExportSheet
        open={sheetOpen}
        onClose={closeSheet}
        track={track}
        rawLyrics={rawLyrics}
      />
    </div>
  );
}
