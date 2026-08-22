"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Music2 } from "lucide-react";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { formatArtworkUrl } from "@/lib/artwork";
import { formatDuration } from "@/lib/utils";
import {
  formatLyricsOnClient,
  formatXml,
  type LyricsViewFormat,
} from "@/lib/lyrics-formatter";
import { AmllPlayer } from "@/components/amll-player";
import { LyricsCodeViewer } from "@/components/lyrics-code-viewer";

interface LyricsViewProps {
  track: SanitizedTrack<TrackRecord>;
  rawLyrics?: SyncedLyricsPayload | string | null;
  onReset?: () => void;
}

export function LyricsView({ track, rawLyrics, onReset }: LyricsViewProps) {

  const [selectedFormat, setSelectedFormat] =
    useState<LyricsViewFormat>("synced");

  const isSyncedPayload = Array.isArray(rawLyrics);

  const formattedText = useMemo(() => {
    if (selectedFormat === "metadata") {
      return JSON.stringify(track, null, 2);
    }
    if (!rawLyrics) return "";
    if (typeof rawLyrics === "string") {
      if (rawLyrics.trim().startsWith("<") || selectedFormat === "ttml") {
        return formatXml(rawLyrics);
      }
      return rawLyrics;
    }
    if (selectedFormat === "synced") return "";

    return formatLyricsOnClient(
      rawLyrics as SyncedLyricsPayload,
      selectedFormat,
      {
        title: track.title,
        artist: track.artists?.join(", "),
        album: track.album || undefined,
      },
    );
  }, [rawLyrics, selectedFormat, track]);

  const artworkSrc = formatArtworkUrl(track.artwork, 600);

  return (
    <div className="w-full max-w-3xl flex flex-col gap-6 py-6 px-2">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-3.5" />
            <span>Search another song</span>
          </button>
        ) : (
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-3.5" />
            <span>Search another song</span>
          </Link>
        )}
      </div>

      {/* Track Header Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm backdrop-blur-sm overflow-hidden">
        {artworkSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artworkSrc}
            alt={track.title}
            className="size-20 sm:size-24 rounded-xl object-cover shadow-sm ring-1 ring-border/50 shrink-0"
          />
        ) : (
          <div className="size-20 sm:size-24 rounded-xl bg-muted/60 flex items-center justify-center shrink-0">
            <Music2 className="size-8 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0 w-full flex flex-col gap-1">
          <div className="flex items-center gap-2 min-w-0 w-full">
            <h2 className="flex-1 min-w-0 text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
              {track.title}
            </h2>
          </div>

          <p className="max-w-full text-sm font-medium text-muted-foreground truncate">
            {track.artists?.join(", ") || "Unknown Artist"}
          </p>

          <p className="max-w-full text-sm font-medium text-muted-foreground truncate">
            {track.album ? track.album : "Unknown Album"}
          </p>

          <div className="flex items-center gap-3 text-xs text-muted-foreground/80 flex-wrap pt-1">
            {track.durationMs ? (
              <span>{formatDuration(track.durationMs)}</span>
            ) : null}
            {track.lyricsProvider ? (
              <span>
                Provider:{" "}
                <span className="font-semibold uppercase">
                  {track.lyricsProvider}
                </span>
              </span>
            ) : null}
            {track.hasTranslation ? (
              <span className="rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                Translation
              </span>
            ) : null}
            {track.hasRomaji ? (
              <span className="rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                Romaji
              </span>
            ) : null}
            {track.isrc ? (
              <span className="font-mono">ISRC: {track.isrc}</span>
            ) : null}
          </div>

          {/* Streaming Platform links */}
          <div className="flex items-center gap-2 pt-2 flex-wrap">
            {track.spotifyId && (
              <a
                href={`https://open.spotify.com/track/${track.spotifyId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Spotify</span>
                <ExternalLink className="size-2.5" />
              </a>
            )}
            {track.appleMusicId && (
              <a
                href={`https://music.apple.com/song/${track.appleMusicId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Apple Music</span>
                <ExternalLink className="size-2.5" />
              </a>
            )}
            {track.deezerId && (
              <a
                href={`https://www.deezer.com/track/${track.deezerId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Deezer</span>
                <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Format Selector Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-0.5">
        {(
          [
            "synced",
            "ttml",
            "lrc",
            "eslrc",
            "yrc",
            "qrc",
            "ass",
            "json",
            "metadata",
          ] as LyricsViewFormat[]
        ).map((fmt) => (
          <button
            key={fmt}
            type="button"
            disabled={fmt !== "metadata" && !rawLyrics}
            onClick={() => setSelectedFormat(fmt)}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              selectedFormat === fmt
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {fmt === "synced"
              ? "Interactive"
              : fmt === "eslrc"
                ? "ESLRC"
                : fmt === "metadata"
                  ? "Metadata"
                  : fmt}
          </button>
        ))}
      </div>

      {/* Lyrics / Metadata Container */}
      {selectedFormat === "metadata" ? (
        <LyricsCodeViewer
          format="metadata"
          code={formattedText}
          track={track}
        />
      ) : !rawLyrics ? (
        <div className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-xs flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2 min-h-[300px]">
          <Music2 className="size-10 stroke-2 text-primary opacity-60" />
          <p className="text-sm font-medium">
            We couldn&apos;t find lyrics for this track.
          </p>

        </div>
      ) : selectedFormat === "synced" && isSyncedPayload ? (
        <AmllPlayer
          track={track}
          rawLyrics={rawLyrics as SyncedLyricsPayload}
        />
      ) : (
        <LyricsCodeViewer
          format={selectedFormat}
          code={formattedText}
          track={track}
        />
      )}
    </div>
  );
}
