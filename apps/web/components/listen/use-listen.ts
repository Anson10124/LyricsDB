"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioMatchResponse } from "@repo/types";
import { FP_CLIP_SECONDS } from "@repo/audio-fingerprint";
import { MatchError, matchAudio } from "@/lib/api-client";
import { loadFingerprinter } from "@/lib/listen/fingerprint";
import { MicListener, MicUnavailableError, type RecordedClip } from "@/lib/listen/recorder";
import type { PlayerSyncPoint } from "@/components/amll-player";

export type ListenStatus =
  | "idle"
  // Asking for the mic and loading the fingerprinter
  | "starting"
  | "listening"
  | "matching"
  | "following"
  | "no-match"
  // Was following, then stopped hearing the song
  | "lost"
  | "error";

export interface ListenState {
  status: ListenStatus;
  // Loudness of the mic while listening, 0-1
  level: number;
  match: AudioMatchResponse | null;
  syncTo: PlayerSyncPoint | null;
  // True while a follow-up listen runs in the background
  relistening: boolean;
  error: string | null;
}

// While following, listen again this often to stay in sync and catch a new song
export const FOLLOW_INTERVAL_MS = 25_000;
// After a surprising answer, listen again soon to confirm it
const CONFIRM_INTERVAL_MS = 4_000;
// Drift below this isn't worth a visible jump
const MIN_RESYNC_MS = 400;
// A bigger jump than this is only trusted when two listens agree (a repeated
// chorus can match another repeat)
const MAX_TRUSTED_DRIFT_MS = 3_000;
// How far apart two listens may be and still count as agreeing
const AGREEMENT_MS = 1_500;
// Misses in a row before giving up on the song
const MAX_MISSES = 2;

interface Sighting {
  trackId: string;
  offsetMs: number;
  atPerfMs: number;
  response: AudioMatchResponse;
}

function positionAt(sync: PlayerSyncPoint, atPerfMs: number): number {
  return sync.positionMs + (atPerfMs - sync.atPerfMs);
}

// Two listens agree when the second is where the first predicts it should be
function agrees(earlier: Sighting, later: Sighting): boolean {
  return (
    earlier.trackId === later.trackId &&
    Math.abs(
      positionAt({ positionMs: earlier.offsetMs, atPerfMs: earlier.atPerfMs }, later.atPerfMs) -
        later.offsetMs,
    ) <= AGREEMENT_MS
  );
}

const INITIAL: ListenState = {
  status: "idle",
  level: 0,
  match: null,
  syncTo: null,
  relistening: false,
  error: null,
};

export function useListen() {
  const [state, setState] = useState<ListenState>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  const micRef = useRef<MicListener | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missesRef = useRef(0);
  // A surprising answer waiting for a second listen to confirm it
  const pendingRef = useRef<Sighting | null>(null);
  // The next scheduled listen; a ref because listen and run refer to each other
  const runRef = useRef<() => Promise<void>>(async () => {});

  const update = useCallback((patch: Partial<ListenState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const releaseMic = useCallback(() => {
    clearTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    const mic = micRef.current;
    micRef.current = null;
    void mic?.close();
  }, []);

  const follow = useCallback(
    (sighting: Sighting) => {
      pendingRef.current = null;
      missesRef.current = 0;
      update({
        status: "following",
        match: sighting.response,
        syncTo: { positionMs: sighting.offsetMs, atPerfMs: sighting.atPerfMs, playing: true },
        error: null,
      });
    },
    [update],
  );

  // One listen: record, fingerprint, ask the API. Schedules the next one while following.
  const listen = useCallback(async () => {
    const mic = micRef.current;
    if (!mic) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const current = stateRef.current;
    const following = current.status === "following" && current.match && current.syncTo;

    if (following) update({ relistening: true });
    else update({ status: "listening", level: 0, error: null });

    let clip: RecordedClip;
    try {
      clip = await mic.record(FP_CLIP_SECONDS, (level) => update({ level }), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }
    if (!following) update({ status: "matching", level: 0 });

    const fingerprinter = await loadFingerprinter();
    const fingerprint = fingerprinter.fingerprint(clip.samples);
    const expectedOffsetMs = following
      ? positionAt(current.syncTo!, clip.startedAtPerfMs)
      : undefined;

    const schedule = (delay: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => void runRef.current(), delay);
    };

    try {
      const response = await matchAudio(
        {
          fingerprint,
          duration: FP_CLIP_SECONDS,
          expectedTrackId: following ? current.match!.track.id : undefined,
          expectedOffsetMs,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      missesRef.current = 0;
      const sighting: Sighting = {
        trackId: response.track.id,
        offsetMs: response.offsetMs,
        atPerfMs: clip.startedAtPerfMs,
        response,
      };

      if (!following) {
        follow(sighting);
        schedule(FOLLOW_INTERVAL_MS);
        return;
      }

      const sameTrack = response.track.id === current.match!.track.id;
      const drift = Math.abs(response.offsetMs - expectedOffsetMs!);
      if (sameTrack && drift <= MAX_TRUSTED_DRIFT_MS) {
        pendingRef.current = null;
        if (drift >= MIN_RESYNC_MS) {
          update({
            syncTo: { positionMs: response.offsetMs, atPerfMs: clip.startedAtPerfMs, playing: true },
          });
        }
        schedule(FOLLOW_INTERVAL_MS);
        return;
      }

      // A jump or a different song: believe it once a second listen agrees
      const pending = pendingRef.current;
      if (pending && agrees(pending, sighting)) {
        follow(sighting);
        schedule(FOLLOW_INTERVAL_MS);
      } else {
        pendingRef.current = sighting;
        schedule(CONFIRM_INTERVAL_MS);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof MatchError)) throw error;

      if (error.kind === "no-match") {
        if (!following) {
          releaseMic();
          update({ status: "no-match" });
          return;
        }
        missesRef.current += 1;
        if (missesRef.current >= MAX_MISSES) {
          releaseMic();
          const sync = stateRef.current.syncTo;
          update({
            status: "lost",
            syncTo: sync && { ...sync, playing: false },
          });
          return;
        }
        schedule(CONFIRM_INTERVAL_MS);
        return;
      }

      if (following) {
        // Keep the lyrics running and try again when allowed
        const wait = error.retryAfterSec ? error.retryAfterSec * 1000 : FOLLOW_INTERVAL_MS;
        schedule(Math.max(CONFIRM_INTERVAL_MS, wait));
        return;
      }
      throw error;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (following) update({ relistening: false });
    }
  }, [follow, releaseMic, update]);

  // Runs one listen and turns anything unexpected into the error screen
  const run = useCallback(async () => {
    try {
      await listen();
    } catch (error) {
      releaseMic();
      update({
        status: "error",
        relistening: false,
        error: error instanceof Error ? error.message : "Something went wrong while listening.",
      });
    }
  }, [listen, releaseMic, update]);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const start = useCallback(async () => {
    releaseMic();
    pendingRef.current = null;
    missesRef.current = 0;
    const keepFollowing = stateRef.current.status === "lost";
    update({
      status: "starting",
      level: 0,
      error: null,
      relistening: false,
      ...(keepFollowing ? {} : { match: null, syncTo: null }),
    });
    try {
      // Load the fingerprinter while the person answers the mic prompt
      const [mic] = await Promise.all([MicListener.open(), loadFingerprinter()]);
      micRef.current = mic;
    } catch (error) {
      update({
        status: "error",
        match: null,
        syncTo: null,
        error:
          error instanceof MicUnavailableError
            ? error.message
            : "Couldn't start listening. Please try again.",
      });
      return;
    }
    await run();
  }, [releaseMic, run, update]);

  const stop = useCallback(() => {
    releaseMic();
    pendingRef.current = null;
    setState(INITIAL);
  }, [releaseMic]);

  // Free the mic when leaving the page
  useEffect(() => releaseMic, [releaseMic]);

  return { state, start, stop };
}
