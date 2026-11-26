"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AudioLines, ExternalLink, LoaderCircle, Mic, MicOff, Square } from "lucide-react";
import type { SanitizedTrack, TrackRecord } from "@repo/types";
import { resolveTrackArtwork } from "@/lib/artwork";
import { uniqueArtists } from "@/lib/utils";
import { press, rise, spring, stagger } from "@/lib/motion";
import { AmllPlayer } from "@/components/amll-player";
import { CoverImage, optimizedCoverUrl } from "@/components/cover-image";
import { SiteHeader } from "@/components/site-header";
import { TrackBackground } from "@/components/track/track-background";
import { useListen, type ListenState, type ListenStatus } from "./use-listen";

const glassButton =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/85 ring-1 ring-white/15 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-white cursor-pointer";

const BUSY: ListenStatus[] = ["starting", "listening", "matching"];

const PROMPT_TEXT: Record<ListenStatus, { title: string; detail: string }> = {
  idle: {
    title: "What's playing?",
    detail: "Hold your device near the music and the lyrics will follow along.",
  },
  starting: { title: "Getting ready…", detail: "Allow the microphone if your browser asks." },
  listening: { title: "Listening…", detail: "Keep the music playing." },
  matching: { title: "Finding the song…", detail: "Matching what we heard." },
  following: { title: "", detail: "" },
  "no-match": {
    title: "Couldn't recognise that",
    detail: "Try again a little closer to the music, or when the singing starts.",
  },
  lost: { title: "Lost the song", detail: "Tap to listen again." },
  error: { title: "Couldn't listen", detail: "" },
};

// The big round button; its halo follows the mic level while listening
function ListenButton({
  state,
  onStart,
}: {
  state: ListenState;
  onStart: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const busy = BUSY.includes(state.status);
  const halo = state.status === "listening" ? 1 + Math.min(1, state.level * 10) * 0.35 : 1;
  const Icon = state.status === "error" ? MicOff : state.status === "matching" ? AudioLines : Mic;

  return (
    <div className="relative flex size-44 items-center justify-center sm:size-52">
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full bg-white/10 ring-1 ring-white/15"
        animate={{ scale: reduceMotion ? 1 : halo }}
        transition={spring.snappy}
      />
      {busy && !reduceMotion && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-white/30"
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 1.45, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.button
        type="button"
        onClick={onStart}
        disabled={busy}
        whileHover={busy ? undefined : { scale: 1.04 }}
        whileTap={busy ? undefined : press}
        transition={spring.snappy}
        aria-label={busy ? PROMPT_TEXT[state.status].title : "Start listening"}
        className="relative flex size-32 items-center justify-center rounded-full bg-white text-black shadow-2xl shadow-black/40 transition-colors hover:bg-white/90 disabled:cursor-default sm:size-36 cursor-pointer"
      >
        {state.status === "starting" ? (
          <LoaderCircle className="size-10 animate-spin" />
        ) : (
          <Icon className="size-10" />
        )}
      </motion.button>
    </div>
  );
}

function ListenPrompt({ state, onStart }: { state: ListenState; onStart: () => void }) {
  const text = PROMPT_TEXT[state.status];
  return (
    <motion.div
      variants={stagger(0.08, 0.1)}
      initial="hidden"
      animate="show"
      className="relative z-10 flex h-full flex-col items-center justify-center gap-8 px-4 pt-16 text-center"
    >
      <motion.div variants={rise}>
        <ListenButton state={state} onStart={onStart} />
      </motion.div>
      <motion.div variants={rise} className="flex max-w-sm flex-col gap-2" aria-live="polite">
        <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{text.title}</h1>
        <p className="text-base text-white/70 text-balance">{state.error ?? text.detail}</p>
      </motion.div>
      {state.status === "idle" && (
        <motion.p variants={rise} className="max-w-xs text-xs text-white/50 text-balance">
          Your audio stays on your device. Only audio fingerprint is sent to our server and NetEase Cloud Music for recognition.
        </motion.p>
      )}
    </motion.div>
  );
}

function Following({
  state,
  track,
  onStart,
  onStop,
}: {
  state: ListenState;
  track: SanitizedTrack<TrackRecord>;
  onStart: () => void;
  onStop: () => void;
}) {
  const [playing, setPlaying] = useState(true);
  const artwork = resolveTrackArtwork(track.artwork, 1000);
  const cover = artwork.imageCover ? optimizedCoverUrl(artwork.imageCover, 400) : undefined;
  const artistLine = uniqueArtists(track.artists).join(", ") || "Unknown Artist";
  const lyrics = state.match?.lyrics;
  const following = state.status === "following";
  const busy = BUSY.includes(state.status);

  return (
    <>
      <TrackBackground
        imageCover={artwork.imageCover ? optimizedCoverUrl(artwork.imageCover, 128) : undefined}
        playing={following && playing}
      />
      <div className="relative z-10 mx-auto grid h-full w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-6 px-5 pt-24 pb-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:grid-rows-1 lg:gap-14 lg:pb-8">
        <motion.aside
          variants={stagger(0.06, 0.1)}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-5 lg:justify-center"
        >
          <div className="flex items-center gap-4 lg:flex-col lg:items-stretch lg:gap-6">
            <motion.div
              key={track.id}
              initial={{ opacity: 0, scale: 0.88, y: 16 }}
              animate={{ opacity: 1, scale: following && playing ? 1 : 0.9, y: 0 }}
              transition={{ ...spring.soft, opacity: { duration: 0.6 } }}
              className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-xl bg-white/10 shadow-2xl shadow-black/40 ring-1 ring-white/10 sm:w-32 lg:w-full lg:rounded-2xl"
            >
              {cover && (
                <CoverImage src={cover} alt={track.album || track.title} sizes="(min-width: 1024px) 400px, 128px" />
              )}
            </motion.div>
            <motion.div variants={rise} className="flex min-w-0 flex-col gap-1">
              <h1
                className="line-clamp-2 text-2xl font-bold leading-tight tracking-tight text-balance sm:text-3xl"
                title={track.title}
              >
                {track.title}
              </h1>
              <p className="truncate text-base font-medium text-white/75 sm:text-lg">{artistLine}</p>
            </motion.div>
          </div>

          <motion.div variants={rise} className="flex flex-wrap items-center gap-2" aria-live="polite">
            {following ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white/85 ring-1 ring-white/15 backdrop-blur-xl">
                <span className="relative flex size-2">
                  {state.relistening && (
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                  )}
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
                </span>
                {state.relistening ? "Checking the song…" : "Listening along"}
              </span>
            ) : (
              <motion.button
                type="button"
                onClick={onStart}
                disabled={busy}
                whileTap={busy ? undefined : press}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-black/20 transition-colors hover:bg-white/90 disabled:opacity-70 cursor-pointer"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Mic className="size-4" />}
                {busy ? PROMPT_TEXT[state.status].title : "Lost the song · Listen again"}
              </motion.button>
            )}
            {following && (
              <motion.button type="button" onClick={onStop} whileTap={press} className={glassButton}>
                <Square className="size-3.5 fill-current" />
                Stop
              </motion.button>
            )}
            <Link href={`/track/${encodeURIComponent(track.id)}`} className={glassButton}>
              <ExternalLink className="size-3.5" />
              Track page
            </Link>
          </motion.div>
        </motion.aside>

        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative min-h-0"
          aria-label="Lyrics"
        >
          {lyrics && lyrics.length > 0 && state.syncTo ? (
            <AmllPlayer
              track={track}
              rawLyrics={lyrics}
              syncTo={state.syncTo}
              allowPreview={false}
              allowTrackNavigation={false}
              onPlayingChange={setPlaying}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <p className="max-w-xs text-lg font-medium text-white/70 text-balance">
                No synced lyrics for this song yet.
              </p>
            </div>
          )}
        </motion.section>
      </div>
    </>
  );
}

export function ListenView() {
  const { state, start, stop } = useListen();
  const track = state.match?.track;

  return (
    <div className="dark relative h-svh overflow-hidden text-white">
      <SiteHeader tone="overlay" />
      <AnimatePresence mode="wait" initial={false}>
        {track ? (
          <motion.div
            key="following"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Following state={state} track={track} onStart={start} onStop={stop} />
          </motion.div>
        ) : (
          <motion.div
            key="prompt"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <TrackBackground playing={false} />
            <ListenPrompt state={state} onStart={start} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
