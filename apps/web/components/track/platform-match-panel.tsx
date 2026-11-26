"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Music2,
  RotateCw,
  X,
} from "lucide-react";
import type {
  PlatformSearchResult,
  SanitizedTrack,
  TrackRecord,
} from "@repo/types";
import { CoverImage } from "@/components/cover-image";
import { formatArtworkUrl } from "@/lib/artwork";
import { press, spring } from "@/lib/motion";
import { cn, formatDuration, uniqueArtists } from "@/lib/utils";

export type PlatformSearchState =
  | { status: "loading" }
  | { status: "error"; message: string; canRetry: boolean }
  | { status: "done"; results: PlatformSearchResult[] };

interface PlatformMatchPanelProps {
  track: SanitizedTrack<TrackRecord>;
  platformLabel: string;
  state: PlatformSearchState;
  onUse: (id: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

// ---------- Comparing ----------

// Lowercase letters and digits only, accents dropped: "Café (Live)" -> "cafe live"
function normalize(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sameText(a?: string | null, b?: string | null): boolean {
  const x = normalize(a);
  return Boolean(x) && x === normalize(b);
}

// Platforms join artists differently ("A & B", ["A", "B"]), so any shared name counts
function artistsMatch(a: string[], b: string[]): boolean {
  const joinedA = normalize(a.join(" "));
  const joinedB = normalize(b.join(" "));
  if (!joinedA || !joinedB) return false;
  return (
    a.some((name) => normalize(name) && joinedB.includes(normalize(name))) ||
    b.some((name) => normalize(name) && joinedA.includes(normalize(name)))
  );
}

// Whole seconds the result is longer (+) or shorter (-), or null when close enough
const DURATION_TOLERANCE_MS = 3000;
function durationOff(trackMs?: number, resultMs?: number): number | null {
  if (!trackMs || !resultMs) return null;
  const delta = resultMs - trackMs;
  return Math.abs(delta) <= DURATION_TOLERANCE_MS
    ? null
    : Math.round(delta / 1000);
}

const differs = "text-amber-300";

function DurationOff({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null;
  return (
    <span className="ml-1.5 rounded bg-amber-400/15 px-1 py-px text-[10px] font-semibold text-amber-300">
      {seconds > 0 ? "+" : "−"}
      {Math.abs(seconds)}s
    </span>
  );
}

function Cover({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg bg-white/5",
        className,
      )}
    >
      {src ? (
        <CoverImage src={src} alt={alt} sizes="64px" />
      ) : (
        <div className="flex size-full items-center justify-center text-white/30">
          <Music2 className="size-5" />
        </div>
      )}
    </div>
  );
}

const primaryButton =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/20 hover:text-white";
const iconLink =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white";

function TakenNote({ trackId }: { trackId: string }) {
  return (
    <p className="text-xs text-red-200">
      Already linked to another track.{" "}
      <Link
        href={`/track/${trackId}`}
        className="font-semibold underline underline-offset-2"
      >
        Open it
      </Link>
    </p>
  );
}

// ---------- Steps ----------

function CompareStep({
  track,
  platformLabel,
  best,
  others,
  onUse,
  onShowOthers,
}: {
  track: SanitizedTrack<TrackRecord>;
  platformLabel: string;
  best: PlatformSearchResult;
  others: number;
  onUse: (id: string) => void;
  onShowOthers: () => void;
}) {
  const trackArtists = uniqueArtists(track.artists);
  const off = durationOff(track.durationMs, best.durationMs);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold">Is this the same song?</p>

      <div className="grid gap-2 @xl:grid-cols-2">
        {/* The song every ID should match; side by side once the panel is wide enough */}
        <div className="flex min-w-0 gap-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
          <Cover
            src={formatArtworkUrl(track.artwork, 200) || undefined}
            alt={track.album || track.title}
            className="size-16"
          />
          <div className="min-w-0 text-sm">
            <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
              This track
            </p>
            <p className="line-clamp-2 font-semibold break-words">
              {track.title}
            </p>
            <p className="truncate text-white/60">
              {trackArtists.join(", ") || "Unknown artist"}
            </p>
            <p className="truncate text-xs text-white/45">
              {[track.album, formatDuration(track.durationMs)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        {/* The best result; fields that don't match are highlighted */}
        <div className="flex min-w-0 gap-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
          <Cover
            src={best.artworkUrl}
            alt={best.album || best.title}
            className="size-16"
          />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
              Best match on {platformLabel}
            </p>
            <p
              className={cn(
                "line-clamp-2 font-semibold break-words",
                !sameText(track.title, best.title) && differs,
              )}
              title={best.title}
            >
              {best.title}
            </p>
            <p
              className={cn(
                "truncate text-white/60",
                !artistsMatch(trackArtists, best.artists) && differs,
              )}
            >
              {best.artists.join(", ") || "Unknown artist"}
            </p>
            <p className="truncate text-xs text-white/45">
              {best.album && (
                <span
                  className={cn(!sameText(track.album, best.album) && differs)}
                >
                  {best.album}
                </span>
              )}
              {best.album && best.durationMs ? " · " : null}
              {best.durationMs ? (
                <span className={cn(off !== null && differs)}>
                  {formatDuration(best.durationMs)}
                </span>
              ) : null}
              <DurationOff seconds={off} />
            </p>
          </div>
          <a
            href={best.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open this result on ${platformLabel}`}
            title={`Open on ${platformLabel}`}
            className={cn(iconLink, "-mt-1 -mr-1 size-8")}
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      {best.confident ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-300">
          <Check className="size-3.5 shrink-0" />
          Looks like the same recording ({Math.round(best.score * 100)}%
          similar).
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0" />
          Not a confident match ({Math.round(best.score * 100)}% similar). Check
          the highlighted details before using it.
        </p>
      )}
      {best.takenByTrackId && <TakenNote trackId={best.takenByTrackId} />}

      <div className="flex flex-wrap items-center gap-2">
        <motion.button
          type="button"
          whileTap={best.takenByTrackId ? undefined : press}
          transition={spring.snappy}
          onClick={() => onUse(best.id)}
          disabled={Boolean(best.takenByTrackId)}
          className={primaryButton}
        >
          <Check className="size-4" />
          Yes, use this
        </motion.button>
        <motion.button
          type="button"
          whileTap={press}
          transition={spring.snappy}
          onClick={onShowOthers}
          className={secondaryButton}
        >
          {others > 0 ? `No, show other results (${others})` : "No"}
        </motion.button>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  track,
  platformLabel,
  onUse,
}: {
  result: PlatformSearchResult;
  track: SanitizedTrack<TrackRecord>;
  platformLabel: string;
  onUse: (id: string) => void;
}) {
  const off = durationOff(track.durationMs, result.durationMs);
  const details = [result.artists.join(", "), result.album]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-center gap-3 py-2.5">
      <Cover
        src={result.artworkUrl}
        alt={result.album || result.title}
        className="size-11"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={result.title}>
          {result.title}
        </p>
        <p className="truncate text-xs text-white/55" title={details}>
          {details || "Unknown artist"}
        </p>
        <p className="text-xs text-white/40">
          {result.durationMs ? formatDuration(result.durationMs) : "—"}
          <DurationOff seconds={off} />
          <span className="ml-2">
            {Math.round(result.score * 100)}% similar
          </span>
        </p>
        {result.takenByTrackId && <TakenNote trackId={result.takenByTrackId} />}
      </div>
      <a
        href={result.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${result.title} on ${platformLabel}`}
        title={`Open on ${platformLabel}`}
        className={iconLink}
      >
        <ExternalLink className="size-3.5" />
      </a>
      <button
        type="button"
        onClick={() => onUse(result.id)}
        disabled={Boolean(result.takenByTrackId)}
        className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full bg-white/10 px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10 disabled:hover:text-white/85"
      >
        Use
      </button>
    </li>
  );
}

// ---------- Panel ----------

/**
 * Search results for one platform, under its ID row. First asks whether the
 * best result is the same song, side by side with the track; "No" lists the
 * rest. Choosing one only fills in the field: the edit is saved with Save.
 */
export function PlatformMatchPanel({
  track,
  platformLabel,
  state,
  onUse,
  onRetry,
  onClose,
}: PlatformMatchPanelProps) {
  const [step, setStep] = useState<"compare" | "list">("compare");

  let body: ReactNode;
  if (state.status === "loading") {
    body = (
      <p
        className="flex items-center gap-2 py-1 text-sm text-white/60"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" />
        Searching {platformLabel}…
      </p>
    );
  } else if (state.status === "error") {
    body = (
      <div className="flex flex-wrap items-center gap-3" role="alert">
        <p className="flex items-center gap-1.5 text-sm text-red-200">
          <AlertTriangle className="size-4 shrink-0" />
          {state.message}
        </p>
        {state.canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={cn(secondaryButton, "h-8 px-3 text-xs")}
          >
            <RotateCw className="size-3.5" />
            Try again
          </button>
        )}
      </div>
    );
  } else if (state.results.length === 0) {
    body = (
      <p className="py-1 text-sm text-white/60">
        Nothing on {platformLabel} looks like this track. If it is there under
        another name, paste its ID in the box above.
      </p>
    );
  } else {
    const [best, ...rest] = state.results;
    body =
      step === "compare" ? (
        <CompareStep
          track={track}
          platformLabel={platformLabel}
          best={best!}
          others={rest.length}
          onUse={onUse}
          onShowOthers={() => setStep("list")}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep("compare")}
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-white/55 transition-colors hover:text-white"
            >
              <ArrowLeft className="size-3.5" />
              Best match
            </button>
            <p className="text-sm font-semibold">
              Other results on {platformLabel}
            </p>
          </div>
          {rest.length > 0 ? (
            <ul className="divide-y divide-white/[0.06]">
              {rest.map((result) => (
                <ResultRow
                  key={result.id}
                  result={result}
                  track={track}
                  platformLabel={platformLabel}
                  onUse={onUse}
                />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-white/60">No other results.</p>
          )}
          <p className="pt-1 text-xs text-white/45">
            None of these is right? Leave the box empty, or paste the ID
            yourself.
          </p>
        </div>
      );
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring.smooth}
      className="overflow-hidden"
    >
      <div
        role="region"
        aria-label={`${platformLabel} search results`}
        className="@container relative mt-3 rounded-2xl bg-black/25 p-3 pr-11 ring-1 ring-white/10 sm:p-4 sm:pr-12"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search results"
          className="absolute top-2 right-2 flex size-8 cursor-pointer items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
        {body}
      </div>
    </motion.div>
  );
}
