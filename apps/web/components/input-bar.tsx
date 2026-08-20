"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputBarProps {
  onSearch?: (query: string) => void;
  isLoading?: boolean;
}

export function InputBar({ onSearch, isLoading = false }: InputBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSearch?.(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-2xl px-4">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={cn(
          "relative flex items-center gap-2 rounded-2xl border px-4 py-2.5 transition-colors duration-300",
          isFocused
            ? "border-primary/50 bg-background/95 ring-2 ring-primary/20"
            : "border-border/70 bg-card/80 hover:border-border hover:bg-card/95"
        )}
      >
        <div className="flex shrink-0 items-center justify-center text-muted-foreground">
          <Search className="size-5" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="https://open.spotify.com/track/..."
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
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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
                className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Search className="size-3.5" />
                <span>Search</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </form>
  );
}

