"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Music2, X } from "lucide-react";
import { toast } from "sonner";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { LyricsView } from "@/components/lyrics-view";
import { TaskProgressState, TaskRows } from "@/components/task-rows";
import {
  fetchTrackById,
  fetchTrackLyrics,
  getLyricsStreamUrl,
  markTrackVerified,
} from "@/lib/api-client";
import { getTurnstileToken } from "@/lib/turnstile";
import { formatArtworkUrl } from "@/lib/artwork";
import {
  applyStreamEvent,
  completeProgress,
  failProgress,
  initialProgress,
} from "@/lib/stream-progress";

interface TrackPageProps {
  params: Promise<{ id: string }>;
}

interface RefreshPanelState {
  open: boolean;
  // Bumped per refresh so the task rows start with fresh open/closed state
  run: number;
  status: "running" | "done" | "failed";
  error?: string;
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
  const [markingCorrect, setMarkingCorrect] = useState(false);
  const [progress, setProgress] = useState<TaskProgressState>(initialProgress);
  const [panel, setPanel] = useState<RefreshPanelState>({
    open: false,
    run: 0,
    status: "running",
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const hidePanelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);

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
      if (hidePanelTimeoutRef.current) {
        clearTimeout(hidePanelTimeoutRef.current);
      }
    };
  }, []);

  const closePanel = () => {
    if (hidePanelTimeoutRef.current) {
      clearTimeout(hidePanelTimeoutRef.current);
      hidePanelTimeoutRef.current = null;
    }
    setPanel((prev) => ({ ...prev, open: false }));
  };

  const handleMarkCorrect = async () => {
    if (!track || track.isVerified || markingCorrect || refreshing) return;
    const container = turnstileContainerRef.current;
    if (!container) return;

    setMarkingCorrect(true);
    try {
      // A fresh single-use challenge on every click (no-op when Turnstile is off)
      const token = await getTurnstileToken(container, "verify-track");
      const updated = await markTrackVerified(track.id, token);
      setTrack(updated);
      toast.success("Thanks! Track marked as correct.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to mark track as correct.",
      );
    } finally {
      setMarkingCorrect(false);
    }
  };

  const handleRefresh = () => {
    if (!track || refreshing || track.isVerified) return;

    const source = getRefreshSource(track);
    if (!source) {
      toast.error("This track has no platform link to refresh from.");
      return;
    }

    eventSourceRef.current?.close();
    if (hidePanelTimeoutRef.current) {
      clearTimeout(hidePanelTimeoutRef.current);
      hidePanelTimeoutRef.current = null;
    }

    setRefreshing(true);
    setProgress({
      ...initialProgress,
      metaStatus: "running",
      metaData: {
        title: track.title,
        artist: track.artists?.join(", "),
        artists: track.artists,
        durationMs: track.durationMs || undefined,
        artworkUrl: formatArtworkUrl(track.artwork, 300) || undefined,
        platform: source.platform,
        id: source.id,
      },
    });
    setPanel((prev) => ({ open: true, run: prev.run + 1, status: "running" }));

    // Same SSE pipeline as search, with the cache bypassed (uncached rate limit applies)
    const es = new EventSource(
      getLyricsStreamUrl({ ...source, forceRefresh: true }),
    );
    eventSourceRef.current = es;

    const finish = (
      status: RefreshPanelState["status"],
      errorMessage?: string,
    ) => {
      es.close();
      if (eventSourceRef.current === es) {
        eventSourceRef.current = null;
      }
      setRefreshing(false);
      setPanel((prev) => ({ ...prev, status, error: errorMessage }));
      if (status === "done") {
        hidePanelTimeoutRef.current = setTimeout(() => {
          setPanel((prev) => ({ ...prev, open: false }));
        }, 2000);
      }
    };

    es.onmessage = async (event) => {
      let payload: { stage?: string; data?: Record<string, unknown> };
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
        return;
      }

      const { stage, data } = payload;
      if (!stage) return;

      if (stage === "error") {
        setProgress((prev) => applyStreamEvent(prev, stage, data));
        finish(
          "failed",
          typeof data?.error === "string"
            ? data.error
            : "Failed to refresh track.",
        );
        return;
      }

      if (stage !== "done") {
        setProgress((prev) => applyStreamEvent(prev, stage, data));
        return;
      }

      es.close();
      const refreshed = data?.track as
        | { id?: string; hasLyrics?: boolean }
        | undefined;
      setProgress((prev) =>
        completeProgress(prev, Boolean(refreshed?.hasLyrics)),
      );

      if (refreshed?.id && refreshed.id !== id) {
        finish("done");
        router.replace(`/track/${refreshed.id}`);
        return;
      }

      try {
        const reloaded = await loadTrackData(id);
        setTrack(reloaded.track);
        setLyrics(reloaded.lyrics);
        finish("done");
      } catch (err) {
        finish(
          "failed",
          err instanceof Error ? err.message : "Failed to reload track.",
        );
      }
    };

    es.onerror = () => {
      setProgress(failProgress);
      finish("failed", "Lost connection while refreshing. Please try again.");
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
            onMarkCorrect={handleMarkCorrect}
            isMarkingCorrect={markingCorrect}
          />
        </motion.div>
      )}

      {/* Turnstile only shows here when Cloudflare needs the visitor to interact */}
      <div
        ref={turnstileContainerRef}
        className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 empty:hidden"
      />

      {/* Live refresh progress, docked to the side so the lyrics stay visible */}
      <AnimatePresence>
        {panel.open && (
          <motion.aside
            key="refresh-panel"
            initial={{ opacity: 0, x: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 24, filter: "blur(8px)" }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            aria-live="polite"
            className="fixed bottom-4 left-4 right-4 z-40 flex max-h-[calc(100vh-2rem)] flex-col gap-3 overflow-y-auto rounded-3xl border border-border/70 bg-background/85 p-3 shadow-lg backdrop-blur-md sm:left-auto sm:w-[400px]"
          >
            <div className="flex items-start justify-between gap-3 px-1 pt-1">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  {panel.status === "running"
                    ? "Refreshing Track"
                    : panel.status === "done"
                      ? "Track Refreshed"
                      : "Refresh Failed"}
                </h2>
                <p
                  className={`text-xs ${panel.status === "failed" ? "text-red-500" : "text-muted-foreground"}`}
                >
                  {panel.status === "failed"
                    ? panel.error
                    : panel.status === "done"
                      ? "Showing the latest data from upstream providers"
                      : "Re-fetching metadata and lyrics from upstream providers"}
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Hide refresh progress"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            <TaskRows key={panel.run} progress={progress} />
          </motion.aside>
        )}
      </AnimatePresence>
    </main>
  );
}
