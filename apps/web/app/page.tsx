"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { SanitizedTrack, SyncedLyricsPayload, TrackRecord } from "@repo/types";
import { InputBar } from "@/components/input-bar";
import { TaskProgressState, TaskRows } from "@/components/task-rows";
import { LyricsView } from "@/components/lyrics-view";

import Link from "next/link";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const initialProgress: TaskProgressState = {
  metaStatus: "pending",
  platformsStatus: "pending",
  matchedPlatforms: [],
  searchingPlatforms: [],
  lyricsStatus: "pending",
  lyricsSearchingProviders: [],
  saveStatus: "pending",
};

export default function Home() {
  const router = useRouter();
  const [viewState, setViewState] = useState<"search" | "progress" | "lyrics">("search");
  const [progress, setProgress] = useState<TaskProgressState>(initialProgress);
  const [result, setResult] = useState<{
    track: SanitizedTrack<TrackRecord>;
    lyrics?: SyncedLyricsPayload | string | null;
  } | null>(null);

  const isCacheHitRef = useRef<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const doneTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    setProgress(initialProgress);
    setResult(null);
    setViewState("search");
  };

  const handleSearch = (url: string) => {
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
    });
    setResult(null);

    const streamUrl = `${API_BASE_URL}/api/lyrics/stream?url=${encodeURIComponent(url)}`;
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
            if (data?.step === "extracting_metadata") {
              setProgress((prev) => ({
                ...prev,
                metaStatus: "running",
                metaData: {
                  ...prev.metaData,
                  platform: data.platform,
                  id: data.id,
                },
              }));
            } else if (data?.step === "parsed_metadata") {
              setProgress((prev) => ({
                ...prev,
                metaStatus: "done",
                platformsStatus: "running",
                metaData: {
                  title: data.title,
                  artist: data.artist,
                  artists: data.artists,
                  durationMs: data.durationMs,
                  artworkUrl: data.artworkUrl,
                },
              }));
            } else if (data?.step === "searching_adapter") {
              setProgress((prev) => ({
                ...prev,
                platformsStatus: "running",
                searchingPlatforms: Array.from(
                  new Set([...prev.searchingPlatforms, data.platform])
                ),
              }));
            }
            break;
          }

          case "platform_matched": {
            setProgress((prev) => ({
              ...prev,
              matchedPlatforms: [
                ...prev.matchedPlatforms.filter((p) => p.platform !== data.platform),
                { platform: data.platform, id: data.id, score: data.score },
              ],
            }));
            break;
          }

          case "lyrics_searching": {
            setProgress((prev) => {
              const updatedProviders = [...prev.lyricsSearchingProviders];
              if (data?.provider) {
                const existingIdx = updatedProviders.findIndex(
                  (p) => p.provider.toLowerCase() === data.provider.toLowerCase()
                );
                if (existingIdx >= 0) {
                  updatedProviders[existingIdx] = {
                    provider: data.provider,
                    status: data.status,
                  };
                } else {
                  updatedProviders.push({
                    provider: data.provider,
                    status: data.status,
                  });
                }
              }

              return {
                ...prev,
                platformsStatus: "done",
                lyricsStatus: data?.status === "not_found" && prev.lyricsStatus !== "done" ? "failed" : "running",
                lyricsSearchingProviders: updatedProviders,
              };
            });
            break;
          }

          case "lyrics_found": {
            setProgress((prev) => {
              const winningProvider = data?.provider?.toLowerCase();
              const updatedProviders = prev.lyricsSearchingProviders.map((p) => {
                if (p.provider.toLowerCase() === winningProvider) {
                  return { ...p, status: "found" as const };
                }
                return {
                  ...p,
                  status: p.status === "searching" ? ("not_found" as const) : p.status,
                };
              });

              if (
                winningProvider &&
                !updatedProviders.some((p) => p.provider.toLowerCase() === winningProvider)
              ) {
                updatedProviders.push({ provider: data.provider, status: "found" });
              }

              return {
                ...prev,
                lyricsStatus: "done",
                lyricsSearchingProviders: updatedProviders,
                lyricsResult: {
                  provider: data?.provider,
                  lyricsType: data?.lyricsType,
                  hasLyrics: true,
                },
              };
            });
            break;
          }

          case "saving": {
            setProgress((prev) => ({
              ...prev,
              lyricsStatus: prev.lyricsStatus === "running" ? "done" : prev.lyricsStatus,
              saveStatus: "running",
            }));
            break;
          }

          case "done": {
            es.close();
            const track = data?.track;
            const lyrics = data?.lyrics;

            setResult({ track, lyrics });

            if (isCacheHitRef.current) {
              if (track?.id) {
                router.push(`/track/${track.id}`);
              } else {
                setViewState("lyrics");
              }
            } else {
              setProgress((prev) => ({
                ...prev,
                metaStatus: "done",
                platformsStatus: "done",
                lyricsStatus: track?.hasLyrics ? "done" : prev.lyricsStatus === "done" ? "done" : "failed",
                saveStatus: "done",
              }));

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
            setProgress((prev) => ({
              ...prev,
              metaStatus: prev.metaStatus === "running" ? "failed" : prev.metaStatus,
              platformsStatus: prev.platformsStatus === "running" ? "failed" : prev.platformsStatus,
              lyricsStatus: prev.lyricsStatus === "running" ? "failed" : prev.lyricsStatus,
              saveStatus: prev.saveStatus === "running" ? "failed" : prev.saveStatus,
            }));
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

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background text-foreground transition-colors">
      <AnimatePresence mode="wait">
        {viewState === "search" && (
          <motion.div
            key="search-view"
            initial={{ opacity: 0, filter: "blur(12px)", scale: 0.96 }}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, filter: "blur(12px)", scale: 0.96 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-col items-center w-full"
          >
            <div className="flex flex-col items-center gap-3 text-center mb-6 max-w-lg z-10">
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
                Lyrics<span className="text-primary">DB</span>
              </h1>

              <p className="text-sm md:text-base text-muted-foreground">
                Search your favorite song or paste in a link from Spotify, Apple Music, or Deezer to get the lyrics instantly
              </p>
            </div>

            <InputBar onSearch={handleSearch} isLoading={false} />
          </motion.div>
        )}

        {viewState === "progress" && (
          <motion.div
            key="progress-view"
            initial={{ opacity: 0, filter: "blur(12px)", scale: 0.96 }}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, filter: "blur(12px)", scale: 0.96 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-col items-center w-full"
          >
            <div className="flex flex-col items-center gap-1.5 text-center mb-6">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Resolving Track</h2>
              <p className="text-xs text-muted-foreground">Extracting metadata and synchronizing lyrics across providers</p>
            </div>

            <TaskRows progress={progress} />
          </motion.div>
        )}

        {viewState === "lyrics" && result && (
          <motion.div
            key="lyrics-view"
            initial={{ opacity: 0, filter: "blur(12px)", scale: 0.96 }}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, filter: "blur(12px)", scale: 0.96 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-col items-center w-full"
          >
            <LyricsView
              track={result.track}
              rawLyrics={result.lyrics}
              onReset={handleReset}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed top-4 right-4 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
        <Link href="/docs" className="text-sm text-muted-foreground">
          Docs
        </Link>
      </div>
    </main>
  );
}