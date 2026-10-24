import type { TaskProgressState } from "@/components/task-rows";

export const initialProgress: TaskProgressState = {
  metaStatus: "pending",
  platformsStatus: "pending",
  matchedPlatforms: [],
  searchingPlatforms: [],
  lyricsStatus: "pending",
  lyricsSearchingProviders: [],
  saveStatus: "pending",
};

/**
 * Applies one SSE progress event from /api/lyrics/stream to the task rows state.
 * Stages that don't change the rows (init, cache_hit, cache_miss, done) leave it as is.
 */
export function applyStreamEvent(
  prev: TaskProgressState,
  stage: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): TaskProgressState {
  switch (stage) {
    case "resolving": {
      if (data?.step === "extracting_metadata") {
        return {
          ...prev,
          metaStatus: "running",
          metaData: {
            ...prev.metaData,
            platform: data.platform,
            id: data.id,
          },
        };
      }
      if (data?.step === "parsed_metadata") {
        return {
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
        };
      }
      if (data?.step === "searching_adapter") {
        return {
          ...prev,
          platformsStatus: "running",
          searchingPlatforms: Array.from(
            new Set([...prev.searchingPlatforms, data.platform]),
          ),
        };
      }
      return prev;
    }

    case "platform_matched":
      return {
        ...prev,
        matchedPlatforms: [
          ...prev.matchedPlatforms.filter((p) => p.platform !== data.platform),
          { platform: data.platform, id: data.id, score: data.score },
        ],
      };

    case "lyrics_searching": {
      const updatedProviders = [...prev.lyricsSearchingProviders];
      if (data?.provider) {
        const existingIdx = updatedProviders.findIndex(
          (p) => p.provider.toLowerCase() === data.provider.toLowerCase(),
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
        lyricsStatus:
          data?.status === "not_found" && prev.lyricsStatus !== "done"
            ? "failed"
            : "running",
        lyricsSearchingProviders: updatedProviders,
      };
    }

    case "lyrics_found": {
      // Live finds carry `provider`; the "kept existing lyrics" event carries `lyricsProvider`
      const provider: string | undefined =
        data?.provider ?? data?.lyricsProvider ?? undefined;
      const winningProvider = provider?.toLowerCase();
      const updatedProviders = prev.lyricsSearchingProviders.map((p) => {
        if (p.provider.toLowerCase() === winningProvider) {
          return { ...p, status: "found" as const };
        }
        return {
          ...p,
          status:
            p.status === "searching" ? ("not_found" as const) : p.status,
        };
      });

      if (
        provider &&
        winningProvider &&
        !updatedProviders.some(
          (p) => p.provider.toLowerCase() === winningProvider,
        )
      ) {
        updatedProviders.push({ provider, status: "found" });
      }

      return {
        ...prev,
        lyricsStatus: "done",
        lyricsSearchingProviders: updatedProviders,
        lyricsResult: {
          provider,
          lyricsType: data?.lyricsType,
          hasLyrics: true,
        },
      };
    }

    case "saving":
      return {
        ...prev,
        lyricsStatus:
          prev.lyricsStatus === "running" ? "done" : prev.lyricsStatus,
        saveStatus: "running",
      };

    case "error":
      return failProgress(prev);

    default:
      return prev;
  }
}

/** Marks every step finished once the stream reports `done`. */
export function completeProgress(
  prev: TaskProgressState,
  hasLyrics: boolean,
): TaskProgressState {
  return {
    ...prev,
    metaStatus: "done",
    platformsStatus: "done",
    lyricsStatus: hasLyrics
      ? "done"
      : prev.lyricsStatus === "done"
        ? "done"
        : "failed",
    saveStatus: "done",
  };
}

/** Marks whichever steps were still running as failed. */
export function failProgress(prev: TaskProgressState): TaskProgressState {
  return {
    ...prev,
    metaStatus: prev.metaStatus === "running" ? "failed" : prev.metaStatus,
    platformsStatus:
      prev.platformsStatus === "running" ? "failed" : prev.platformsStatus,
    lyricsStatus:
      prev.lyricsStatus === "running" ? "failed" : prev.lyricsStatus,
    saveStatus: prev.saveStatus === "running" ? "failed" : prev.saveStatus,
  };
}
