"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft, Music2 } from "lucide-react";
import type { SanitizedTrack, SyncedLyricsPayload, TrackRecord } from "@repo/types";
import { LyricsView } from "@/components/lyrics-view";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface TrackPageProps {
  params: Promise<{ id: string }>;
}

export default function TrackPage({ params }: TrackPageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<SanitizedTrack<TrackRecord> | null>(null);
  const [lyrics, setLyrics] = useState<SyncedLyricsPayload | string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    async function loadTrackData() {
      try {
        const trackRes = await fetch(`${API_BASE_URL}/api/tracks/${encodeURIComponent(id)}`);
        if (!trackRes.ok) {
          if (trackRes.status === 404) {
            throw new Error("Track not found");
          }
          throw new Error("Failed to load track");
        }
        const trackData = (await trackRes.json()) as SanitizedTrack<TrackRecord>;

        if (!isMounted) return;
        setTrack(trackData);

        if (trackData.hasLyrics) {
          try {
            const lyricsRes = await fetch(
              `${API_BASE_URL}/api/tracks/${encodeURIComponent(id)}/lyrics?format=json`
            );
            if (lyricsRes.ok) {
              const lyricsData = await lyricsRes.json();
              if (isMounted) {
                if (lyricsData && typeof lyricsData === "object" && "plain" in lyricsData) {
                  setLyrics(lyricsData.plain);
                } else {
                  setLyrics(lyricsData);
                }
              }
            }
          } catch {
            // Lyrics fetch fallback
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadTrackData();

    return () => {
      isMounted = false;
    };
  }, [id]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-4 py-12 transition-colors">
      {loading && (
        <motion.div
          key="loading"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4 text-center"
        >
          <div className="flex size-12 items-center justify-center rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <p className="text-sm font-medium text-muted-foreground">Loading track and lyrics...</p>
        </motion.div>
      )}

      {!loading && error && (
        <motion.div
          key="error"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 text-center max-w-md"
        >
          <div className="size-16 rounded-2xl bg-muted/60 flex items-center justify-center">
            <Music2 className="size-8 text-muted-foreground/60" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Track Not Found</h2>
          <p className="text-sm text-muted-foreground">
            The track with ID <span className="font-mono text-xs">{id}</span> could not be found or has not been synchronized yet.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to Search</span>
          </Link>
        </motion.div>
      )}

      {!loading && track && (
        <motion.div
          key="content"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          className="flex flex-col items-center w-full"
        >
          <LyricsView
            track={track}
            rawLyrics={lyrics}
            onReset={() => router.push("/")}
          />
        </motion.div>
      )}
    </main>
  );
}
