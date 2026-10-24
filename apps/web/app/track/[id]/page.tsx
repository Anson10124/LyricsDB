"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft, Music2 } from "lucide-react";
import { toast } from "sonner";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { LyricsView } from "@/components/lyrics-view";
import {
  fetchTrackById,
  fetchTrackLyrics,
  getLyricsStreamUrl,
} from "@/lib/api-client";

interface TrackPageProps {
  params: Promise<{ id: string }>;
}

async function loadTrackData(id: string) {
  const [track, lyricsData] = await Promise.all([
    fetchTrackById(id),
    fetchTrackLyrics(id, "json").catch(() => null),
  ]);

  let lyrics: SyncedLyricsPayload | string | null = null;
  if (lyricsData) {
    if (
      typeof lyricsData === "object" &&
      lyricsData !== null &&
      "plain" in lyricsData
    ) {
      lyrics = (lyricsData as { plain: string }).plain;
    } else {
      lyrics = lyricsData as SyncedLyricsPayload;
    }
  }

  return { track, lyrics };
}

// Picks a platform ID the resolver can re-sync this track from
function getRefreshSource(track: SanitizedTrack<TrackRecord>) {
  const candidates: Array<[string, string | null | undefined]> = [
    ["spotify", track.spotifyId],
    ["apple", track.appleMusicId],
    ["deezer", track.deezerId],
    ["netease", track.neteaseId],
    ["qq", track.qqMusicId],
  ];
  const match = candidates.find(([, platformId]) => platformId);
  return match ? { platform: match[0], id: match[1] as string } : null;
}

export default function TrackPage({ params }: TrackPageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<SanitizedTrack<TrackRecord> | null>(null);
  const [lyrics, setLyrics] = useState<SyncedLyricsPayload | string | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    loadTrackData(id)
      .then((data) => {
        if (!isMounted) return;
        setTrack(data.track);
        setLyrics(data.lyrics);
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "An error occurred");
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleRefresh = () => {
    if (!track || refreshing) return;

    const source = getRefreshSource(track);
    if (!source) {
      toast.error("This track has no platform link to refresh from.");
      return;
    }

    setRefreshing(true);
    eventSourceRef.current?.close();

    // Same SSE pipeline as search, with the cache bypassed (uncached rate limit applies)
    const es = new EventSource(
      getLyricsStreamUrl({ ...source, forceRefresh: true }),
    );
    eventSourceRef.current = es;

    const finish = () => {
      es.close();
      if (eventSourceRef.current === es) {
        eventSourceRef.current = null;
      }
      setRefreshing(false);
    };

    es.onmessage = async (event) => {
      let payload: { stage?: string; data?: Record<string, unknown> };
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
        return;
      }

      if (payload.stage === "error") {
        finish();
        toast.error(
          typeof payload.data?.error === "string"
            ? payload.data.error
            : "Failed to refresh track.",
        );
        return;
      }

      if (payload.stage !== "done") return;
      es.close();

      const refreshedId = (payload.data?.track as { id?: string } | undefined)
        ?.id;
      if (refreshedId && refreshedId !== id) {
        finish();
        router.replace(`/track/${refreshedId}`);
        return;
      }

      try {
        const data = await loadTrackData(id);
        setTrack(data.track);
        setLyrics(data.lyrics);
        toast.success("Track refreshed from upstream providers.");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to reload track.",
        );
      } finally {
        finish();
      }
    };

    es.onerror = () => {
      finish();
      toast.error("Lost connection while refreshing. Please try again.");
    };
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background text-foreground transition-colors">
      {loading && (
        <motion.div
          key="loading"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4 text-center"
        >
          <div className="flex size-12 items-center justify-center rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <p className="text-sm font-medium text-muted-foreground">
            Loading track and lyrics...
          </p>
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
            The track with ID <span className="font-mono text-xs">{id}</span>{" "}
            could not be found or has not been synchronized yet.
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
            onRefresh={handleRefresh}
            isRefreshing={refreshing}
          />
        </motion.div>
      )}
    </main>
  );
}
