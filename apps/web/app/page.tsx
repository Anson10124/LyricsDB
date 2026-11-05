"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import { InputBar } from "@/components/input-bar";
import { TaskProgressState, TaskRows } from "@/components/task-rows";
import { TrackView } from "@/components/track/track-view";
import { SiteHeader } from "@/components/site-header";
import { LibraryShowcase } from "@/components/home/library-showcase";
import { fade, rise, spring, stagger } from "@/lib/motion";
import { LiveActivityToaster } from "@/components/live-activity-toaster";
import type { DeezerTrack } from "@/lib/deezer";

import { getLyricsStreamUrl } from "@/lib/api-client";
import {
  applyStreamEvent,
  completeProgress,
  initialProgress,
} from "@/lib/stream-progress";

export default function Home() {
  const router = useRouter();
  const [viewState, setViewState] = useState<"search" | "progress" | "lyrics">(
    "search",
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [progress, setProgress] = useState<TaskProgressState>(initialProgress);
  const [result, setResult] = useState<{
    track: SanitizedTrack<TrackRecord>;
    lyrics?: SyncedLyricsPayload | string | null;
  } | null>(null);

  const isCacheHitRef = useRef<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const doneTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userResolvedTrackIdsRef = useRef<Set<string>>(new Set());

  const handleReset = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (doneTimeoutRef.current) {
      clearTimeout(doneTimeoutRef.current);
      doneTimeoutRef.current = null;
    }
    isCacheHitRef.current = false;
    setIsDropdownOpen(false);
    setProgress(initialProgress);
    setResult(null);
    setViewState("search");
  };

  const startStream = ({
    url,
    platform,
    id,
    initialMeta,
  }: {
    url?: string;
    platform?: string;
    id?: string;
    initialMeta?: TaskProgressState["metaData"];
  }) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (doneTimeoutRef.current) {
      clearTimeout(doneTimeoutRef.current);
    }

    isCacheHitRef.current = false;
    setProgress({
      ...initialProgress,
      metaStatus: "running",
      metaData: initialMeta,
    });
    setResult(null);

    const streamUrl = getLyricsStreamUrl({ url, platform, id });
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { stage, data } = payload;

        switch (stage) {
          case "cache_hit": {
            isCacheHitRef.current = true;
            break;
          }

          case "cache_miss": {
            isCacheHitRef.current = false;
            setViewState("progress");
            break;
          }

          case "resolving": {
            if (!isCacheHitRef.current) {
              setViewState("progress");
            }
            setProgress((prev) => applyStreamEvent(prev, stage, data));
            break;
          }

          case "platform_matched":
          case "lyrics_searching":
          case "lyrics_found":
          case "saving": {
            setProgress((prev) => applyStreamEvent(prev, stage, data));
            break;
          }

          case "done": {
            es.close();
            const track = data?.track;
            const lyrics = data?.lyrics;

            if (track?.id) {
              userResolvedTrackIdsRef.current.add(track.id);
            }

            setResult({ track, lyrics });

            if (isCacheHitRef.current) {
              if (track?.id) {
                router.push(`/track/${track.id}`);
              } else {
                setViewState("lyrics");
              }
            } else {
              setProgress((prev) =>
                completeProgress(prev, Boolean(track?.hasLyrics)),
              );

              // Grace period to let the user see the completed tasks
              doneTimeoutRef.current = setTimeout(() => {
                if (track?.id) {
                  router.push(`/track/${track.id}`);
                } else {
                  setViewState("lyrics");
                }
              }, 700);
            }
            break;
          }

          case "error": {
            es.close();
            setProgress((prev) => applyStreamEvent(prev, stage, data));
            break;
          }
        }
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
      }
    };

    es.onerror = () => {
      es.close();
    };
  };

  const handleSearchUrl = (url: string) => {
    startStream({ url });
  };

  const handleSelectTrack = (track: DeezerTrack) => {
    startStream({
      platform: "deezer",
      id: String(track.id),
      initialMeta: {
        title: track.title || track.title_short,
        artist: track.artist?.name,
        durationMs: track.duration ? track.duration * 1000 : undefined,
        artworkUrl:
          track.album?.cover_big ||
          track.album?.cover_medium ||
          track.album?.cover_small,
        platform: "deezer",
        id: String(track.id),
      },
    });
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (doneTimeoutRef.current) {
        clearTimeout(doneTimeoutRef.current);
      }
    };
  }, []);

  const isSearching = viewState === "search";

  return (
    <main className="relative min-h-svh overflow-x-hidden bg-background text-foreground">
      <SiteHeader tone={viewState === "lyrics" ? "overlay" : "default"} />

      <AnimatePresence mode="wait">
        {isSearching && (
          <motion.div
            key="search-view"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ ...spring.smooth, opacity: fade }}
            className="relative flex min-h-screen flex-col items-center justify-center gap-6 py-24 sm:gap-8"
          >
            <motion.div
              variants={stagger(0.08)}
              initial="hidden"
              animate="show"
              className="relative z-30 flex w-full flex-col items-center"
            >
              <motion.h1
                variants={rise}
                className="text-5xl font-extrabold tracking-tight md:text-6xl"
              >
                Lyrics<span className="text-primary">DB</span>
              </motion.h1>

              <motion.p
                variants={rise}
                className="mt-3 mb-8 max-w-lg px-4 text-center text-sm text-muted-foreground md:text-base"
              >
                Search your favorite song or paste a link from Spotify, Apple
                Music, or Deezer to get synchronized lyrics instantly
              </motion.p>

              <motion.div
                variants={rise}
                className="flex w-full justify-center"
              >
                <InputBar
                  onSearchUrl={handleSearchUrl}
                  onSelectTrack={handleSelectTrack}
                  onOpenChange={setIsDropdownOpen}
                  isLoading={false}
                />
              </motion.div>
            </motion.div>

            <LibraryShowcase dimmed={isDropdownOpen} />
          </motion.div>
        )}

        {viewState === "progress" && (
          <motion.div
            key="progress-view"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ ...spring.smooth, opacity: fade }}
            className="flex min-h-screen w-full flex-col items-center justify-center px-2"
          >
            <div className="mb-6 flex flex-col items-center gap-1.5 text-center">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                Resolving Track
              </h2>
              <p className="text-xs text-muted-foreground">
                Extracting metadata and synchronizing lyrics across providers
              </p>
            </div>

            <TaskRows progress={progress} />
          </motion.div>
        )}

        {viewState === "lyrics" && result && (
          <motion.div
            key="lyrics-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            className="w-full"
          >
            <TrackView
              track={result.track}
              rawLyrics={result.lyrics}
              onBack={handleReset}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <LiveActivityToaster
        enabled={isSearching}
        ignoredTrackIds={Array.from(userResolvedTrackIdsRef.current)}
      />
    </main>
  );
}
