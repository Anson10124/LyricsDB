"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Clock,
  ExternalLink,
  Loader2,
  Music2,
  Search,
  X,
} from "lucide-react";
import { cn, formatDuration, isStreamingUrl } from "@/lib/utils";
import {
  type DeezerTrack,
  searchDeezerTracks,
} from "@/lib/deezer";

interface InputBarProps {
  onSearchUrl?: (url: string) => void;
  onSelectTrack?: (track: DeezerTrack) => void;
  onOpenChange?: (isOpen: boolean) => void;
  isLoading?: boolean;
}


export function InputBar({
  onSearchUrl,
  onSelectTrack,
  onOpenChange,
  isLoading = false,
}: InputBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DeezerTrack[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const currentQueryRef = useRef<string>("");

  const isUrl = isStreamingUrl(query);

  // Search Deezer tracks when query changes
  useEffect(() => {
    currentQueryRef.current = query;
    setSelectedIndex(-1);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    const trimmed = query.trim();

    if (!trimmed || isUrl) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    searchDebounceRef.current = setTimeout(async () => {
      try {
        const tracks = await searchDeezerTracks(trimmed, 10);
        // Ensure query hasn't changed while searching
        if (currentQueryRef.current.trim() === trimmed) {
          setResults(tracks);
          setIsOpen(true);
        }
      } catch (err) {
        console.error("Failed to search tracks:", err);
        if (currentQueryRef.current.trim() === trimmed) {
          setResults([]);
        }
      } finally {
        if (currentQueryRef.current.trim() === trimmed) {
          setIsSearching(false);
        }
      }
    }, 280);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [query, isUrl]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handlePickTrack = (track: DeezerTrack) => {
    setIsOpen(false);
    onSelectTrack?.(track);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    if (isUrl) {
      setIsOpen(false);
      onSearchUrl?.(trimmed);
      return;
    }

    // If an item is selected with arrow keys
    if (selectedIndex >= 0) {
      const selected = results[selectedIndex];
      if (selected) {
        handlePickTrack(selected);
        return;
      }
    }

    // If results are available, select the first match
    if (results.length > 0) {
      const first = results[0];
      if (first) {
        handlePickTrack(first);
        return;
      }
    }

    // Direct search fallback
    onSearchUrl?.(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) {
      if (e.key === "Enter") {
        handleSubmit();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 >= results.length ? 0 : prev + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? results.length - 1 : prev - 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const shouldShowDropdown =
    isOpen &&
    !isUrl &&
    query.trim().length >= 2 &&
    (isSearching || results.length > 0 || !isSearching);

  useEffect(() => {
    onOpenChange?.(shouldShowDropdown);
  }, [shouldShowDropdown, onOpenChange]);

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl px-4 mb-6 z-30">
      <form onSubmit={handleSubmit}>
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={cn(
            "relative flex items-center gap-2.5 rounded-2xl border px-4 py-3 transition-all duration-300 shadow-sm",
            isFocused || isOpen
              ? "border-primary/50 bg-background/95 ring-2 ring-primary/20 shadow-lg"
              : "border-border/70 bg-card/80 hover:border-border hover:bg-card/95",
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            {isSearching ? (
              <Loader2 className="size-5 animate-spin text-primary" />
            ) : (
              <Search className="size-5" />
            )}
          </div>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!isOpen && e.target.value.trim().length >= 2) {
                setIsOpen(true);
              }
            }}
            onFocus={() => {
              setIsFocused(true);
              if (query.trim().length >= 2 && !isUrl) {
                setIsOpen(true);
              }
            }}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Search songs, artists, or paste Spotify / Apple / Deezer link..."
            className="w-full text-base placeholder:text-muted-foreground/70 focus:outline-none bg-transparent"
          />

          <div className="flex shrink-0 items-center gap-1.5">
            <AnimatePresence>
              {query && (
                <motion.button
                  key="clear-button"
                  type="button"
                  onClick={handleClear}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  title="Clear input"
                >
                  <X className="size-4" />
                </motion.button>
              )}

              {query.trim() && (
                <motion.button
                  key="search-button"
                  type="submit"
                  disabled={isLoading}
                  initial={{ scale: 0.8, opacity: 0, x: 8 }}
                  animate={{ scale: 1, opacity: 1, x: 0 }}
                  exit={{ scale: 0.8, opacity: 0, x: 8 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isUrl ? (
                    <>
                      <ExternalLink className="size-3.5" />
                      <span>Resolve Link</span>
                    </>
                  ) : (
                    <>
                      <Search className="size-3.5" />
                      <span>Search</span>
                    </>
                  )}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </form>

      {/* Search Results Dropdown */}
      <AnimatePresence>
        {shouldShowDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="absolute left-4 right-4 top-[calc(100%+8px)] overflow-hidden rounded-2xl border border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border/50 px-3.5 py-2 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                Results
              </span>
              {results.length > 0 && (
                <span>
                  Press <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">↑</kbd> <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">↓</kbd> to navigate, <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">Enter</kbd> to select
                </span>
              )}
            </div>

            <div className="max-h-[min(340px,45vh)] overflow-y-auto p-1.5 flex flex-col gap-1">
              {isSearching && results.length === 0 && (
                <div className="flex items-center justify-center gap-2.5 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span>Searching...</span>
                </div>
              )}

              {!isSearching && results.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
                  <Music2 className="size-8 text-muted-foreground opacity-50" />
                  <p className="text-sm font-medium text-foreground">
                    No tracks found
                  </p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Try searching with song title and artist, or paste a direct Spotify / Apple Music / Deezer link.
                  </p>
                </div>
              )}

              {results.map((track, idx) => {
                const isSelected = selectedIndex === idx;
                const coverUrl =
                  track.album?.cover_medium ||
                  track.album?.cover_small ||
                  track.album?.cover;

                return (
                  <div
                    key={track.id}
                    onClick={() => handlePickTrack(track)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "group flex items-center justify-between gap-3 rounded-xl p-2 text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-muted/80 ring-1 ring-primary/30"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Album Cover Thumbnail */}
                      <div className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/50">
                        {coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={coverUrl}
                            alt={track.album?.title || track.title}
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-muted-foreground">
                            <Music2 className="size-5" />
                          </div>
                        )}
                      </div>

                      {/* Track Title & Artist */}
                      <div className="min-w-0 flex-1 flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {track.title || track.title_short}
                          </span>
                          {track.explicit_lyrics && (
                            <span className="shrink-0 rounded bg-muted px-1 py-0.2 text-[9.5px] font-bold text-muted-foreground border border-border/60">
                              E
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                          <span className="truncate">{track.artist?.name}</span>
                          {track.album?.title && (
                            <>
                              <span className="text-muted-foreground/50">•</span>
                              <span className="truncate text-muted-foreground/80">
                                {track.album.title}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Duration and select indicator */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                        <Clock className="size-3 text-muted-foreground/60" />
                        <span>{formatDuration(track.duration, "s")}</span>
                      </div>


                      <div
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all",
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-muted/50 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                        )}
                      >
                        Select
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
