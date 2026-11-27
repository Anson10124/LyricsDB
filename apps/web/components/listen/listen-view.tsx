"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AudioLines, ExternalLink, LoaderCircle, Mic, MicOff, Square } from "lucide-react";
import type { SanitizedTrack, TrackRecord } from "@repo/types";
import { resolveTrackArtwork } from "@/lib/artwork";
import { uniqueArtists } from "@/lib/utils";
import { press, rise, spring, stagger } from "@/lib/motion";
import { AmllPlayer, PlayerBar } from "@/components/amll-player";
import { optimizedCoverUrl } from "@/components/cover-image";
import { SiteHeader } from "@/components/site-header";
import { TrackBackground } from "@/components/track/track-background";
import { useDeviceAudioSupport } from "@/lib/listen/device-audio-support";
import { useListen, type ListenState, type ListenStatus } from "./use-listen";

const barButton =
  "inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer sm:px-3";

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

// Where device mode needs different words from the mic
const DEVICE_TEXT: Partial<Record<ListenStatus, { title: string; detail: string }>> = {
  starting: {
    title: "Choose what to share",
    detail:
      "Pick the tab playing the music (or your whole screen for a desktop app) and turn on “Share audio”.",
  },
  "no-match": {
    title: "Couldn't recognise that",
    detail: "Make sure the music is playing in what you shared, or try again when the singing starts.",
  },
};

function promptText(state: ListenState) {
  return (state.source === "device" && DEVICE_TEXT[state.status]) || PROMPT_TEXT[state.status];
}

// Statuses where the "Playing on this device?" link is offered
const DEVICE_OFFER: ListenStatus[] = ["idle", "no-match", "error"];

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
        aria-label={busy ? promptText(state).title : "Start listening"}
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

function ListenPrompt({
  state,
  onStart,
  onStartDevice,
}: {
  state: ListenState;
  onStart: () => void;
  onStartDevice: () => void;
}) {
  const text = promptText(state);
  const deviceSupported = useDeviceAudioSupport();
  const pickingShare = state.source === "device" && state.status === "starting";
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
      {deviceSupported && DEVICE_OFFER.includes(state.status) && (
        <motion.button
          type="button"
          variants={rise}
          onClick={onStartDevice}
          className="-mt-4 text-sm text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline cursor-pointer"
        >
          Playing on this device?
        </motion.button>
      )}
      {state.status === "idle" && (
        <motion.p variants={rise} className="max-w-xs text-xs text-white/50 text-balance fixed bottom-4">
          Your audio stays on your device. Only audio fingerprint is sent to our server and NetEase Cloud Music for recognition.
        </motion.p>
      )}
      {pickingShare && (
        <motion.p variants={rise} className="max-w-xs text-xs text-white/50 text-balance fixed bottom-4">
          Your screen isn&apos;t recorded or sent anywhere. Only the audio fingerprint is used for recognition.
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
  const artistLine = uniqueArtists(track.artists).join(", ") || "Unknown Artist";
  const lyrics = state.match?.lyrics;
  const following = state.status === "following";
  const busy = BUSY.includes(state.status);

  const controls = (
    <>
      <div className="flex min-w-0 items-center" aria-live="polite">
        {following ? (
          <span className="inline-flex h-9 min-w-0 items-center gap-2 px-3 text-sm font-medium text-white/85">
            <span className="relative flex size-2 shrink-0">
              {state.relistening && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              )}
              <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
            </span>
            <span className="truncate">
              {state.relistening ? "Checking the song…" : "Listening along"}
            </span>
          </span>
        ) : (
          <motion.button
            type="button"
            onClick={onStart}
            disabled={busy}
            whileTap={busy ? undefined : press}
            title={busy ? undefined : "Lost the song"}
            className="inline-flex h-9 min-w-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-70 cursor-pointer"
          >
            {busy ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin" />
            ) : (
              <Mic className="size-4 shrink-0" />
            )}
            <span className="truncate">{busy ? promptText(state).title : "Listen again"}</span>
          </motion.button>
        )}
      </div>
      {following && (
        <motion.button
          type="button"
          onClick={onStop}
          whileTap={press}
          aria-label="Stop"
          title="Stop"
          className={barButton}
        >
          <Square className="size-3.5 fill-current" />
          <span className="hidden sm:inline">Stop</span>
        </motion.button>
      )}
      <Link
        href={`/track/${encodeURIComponent(track.id)}`}
        aria-label="Track page"
        title="Track page"
        className={barButton}
      >
        <ExternalLink className="size-3.5" />
        <span className="hidden sm:inline">Track page</span>
      </Link>
    </>
  );

  return (
    <>
      <TrackBackground
        imageCover={artwork.imageCover ? optimizedCoverUrl(artwork.imageCover, 128) : undefined}
        playing={following && playing}
      />
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative z-10 mx-auto h-full w-full max-w-4xl px-5 pt-20 pb-6 lg:pb-8"
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
            controls={controls}
          />
        ) : (
          <div className="relative flex h-full items-center justify-center text-center">
            {/* Names the song, as there are no lyrics to recognise it by */}
            <div className="flex max-w-xs flex-col gap-2 text-balance">
              <h1 className="text-2xl font-bold tracking-tight">{track.title}</h1>
              <p className="text-base font-medium text-white/75">{artistLine}</p>
              <p className="text-sm text-white/55">No synced lyrics for this song yet.</p>
            </div>
            <PlayerBar>{controls}</PlayerBar>
          </div>
        )}
      </motion.section>
    </>
  );
}

export function ListenView() {
  const { state, startMic, startDevice, restart, stop } = useListen();
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
            <Following state={state} track={track} onStart={restart} onStop={stop} />
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
            <ListenPrompt state={state} onStart={startMic} onStartDevice={startDevice} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
