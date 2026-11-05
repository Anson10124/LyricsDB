"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useDragControls,
  type PanInfo,
} from "motion/react";
import { Check, Copy, X } from "lucide-react";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import {
  formatLyricsOnClient,
  formatXml,
  type LyricsViewFormat,
} from "@/lib/lyrics-formatter";
import { LyricsCodeViewer } from "@/components/lyrics-code-viewer";
import { fade, press, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type SheetTab = Exclude<LyricsViewFormat, "synced"> | "api";

const TABS: { key: SheetTab; label: string; needsLyrics: boolean }[] = [
  { key: "ttml", label: "TTML", needsLyrics: true },
  { key: "lrc", label: "LRC", needsLyrics: true },
  { key: "eslrc", label: "ESLRC", needsLyrics: true },
  { key: "yrc", label: "YRC", needsLyrics: true },
  { key: "qrc", label: "QRC", needsLyrics: true },
  { key: "ass", label: "ASS", needsLyrics: true },
  { key: "json", label: "JSON", needsLyrics: true },
  { key: "metadata", label: "Metadata", needsLyrics: false },
  { key: "api", label: "API", needsLyrics: false },
];

const API_FORMATS = ["json", "ttml", "lrc", "eslrc", "yrc", "qrc", "ass"];

function ApiSnippet({ trackId }: { trackId: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const snippets = [
    {
      label: "Track metadata",
      command: `curl "${origin}/api/tracks/${trackId}"`,
    },
    {
      label: "Lyrics (pick a format)",
      command: `curl "${origin}/api/tracks/${trackId}/lyrics?format=ttml"`,
    },
  ];

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard can be blocked (insecure origin); the text is still selectable
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-2xl bg-zinc-950/90 p-5 text-zinc-100 ring-1 ring-white/10">
      {snippets.map((snippet) => (
        <div key={snippet.label} className="flex flex-col gap-2">
          <p className="text-xs font-medium text-zinc-400">{snippet.label}</p>
          <div className="flex items-center gap-2 rounded-xl bg-white/5 p-1 pl-3 ring-1 ring-white/10">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-2 font-mono text-xs">
              {snippet.command}
            </code>
            <motion.button
              type="button"
              whileTap={press}
              transition={spring.snappy}
              onClick={() => copy(snippet.command)}
              aria-label={`Copy ${snippet.label} command`}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
            >
              {copied === snippet.command ? (
                <Check className="size-4 text-emerald-400" />
              ) : (
                <Copy className="size-4" />
              )}
            </motion.button>
          </div>
        </div>
      ))}
      <p className="text-xs leading-relaxed text-zinc-400">
        Supported formats:{" "}
        {API_FORMATS.map((format, i) => (
          <span key={format}>
            <code className="font-mono text-zinc-200">{format}</code>
            {i < API_FORMATS.length - 1 ? ", " : ""}
          </span>
        ))}
        . See the{" "}
        <Link
          href="/docs"
          className="text-primary underline-offset-2 hover:underline"
        >
          docs
        </Link>{" "}
        for search, streaming and links.
      </p>
    </div>
  );
}

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  track: SanitizedTrack<TrackRecord>;
  rawLyrics?: SyncedLyricsPayload | string | null;
}

export function ExportSheet({
  open,
  onClose,
  track,
  rawLyrics,
}: ExportSheetProps) {
  const hasLyrics = Boolean(rawLyrics);
  const [tab, setTab] = useState<SheetTab>(hasLyrics ? "ttml" : "metadata");
  const dragControls = useDragControls();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes, and the page behind doesn't scroll while the sheet is up
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  const code = useMemo(() => {
    if (tab === "api") return "";
    if (tab === "metadata") return JSON.stringify(track, null, 2);
    if (!rawLyrics) return "";
    if (typeof rawLyrics === "string") {
      return rawLyrics.trim().startsWith("<") || tab === "ttml"
        ? formatXml(rawLyrics)
        : rawLyrics;
    }
    return formatLyricsOnClient(rawLyrics, tab, {
      title: track.title,
      artist: track.artists?.join(", "),
      album: track.album || undefined,
    });
  }, [rawLyrics, tab, track]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Get lyrics"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={spring.soft}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.8 }}
            onDragEnd={handleDragEnd}
            className="relative flex h-[86dvh] w-full max-w-4xl flex-col rounded-t-[28px] bg-zinc-900/85 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-2xl"
          >
            {/* Grab area: dragging here pulls the sheet down */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="flex cursor-grab touch-none flex-col gap-4 px-5 pt-2.5 pb-4 active:cursor-grabbing"
            >
              <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">
                    Get lyrics
                  </h2>
                  <p className="text-xs text-white/55">
                    Copy or download in any format, or call the API
                  </p>
                </div>
                <motion.button
                  ref={closeRef}
                  type="button"
                  whileTap={press}
                  transition={spring.snappy}
                  onClick={onClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Close"
                  className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white cursor-pointer"
                >
                  <X className="size-4" />
                </motion.button>
              </div>
            </div>

            {/* Segmented control with a sliding selection pill */}
            <div className="px-5">
              <div
                role="tablist"
                aria-label="Format"
                className="flex gap-1 overflow-x-auto rounded-2xl bg-white/5 p-1 ring-1 ring-white/10"
              >
                {TABS.map((item) => {
                  const disabled = item.needsLyrics && !hasLyrics;
                  const selected = tab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      disabled={disabled}
                      onClick={() => setTab(item.key)}
                      className={cn(
                        "relative shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-35",
                        selected
                          ? "text-black"
                          : "text-white/65 hover:text-white",
                      )}
                    >
                      {selected && (
                        <motion.span
                          layoutId="export-sheet-tab"
                          transition={spring.snappy}
                          className="absolute inset-0 rounded-xl bg-white shadow-sm"
                        />
                      )}
                      <span className="relative">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full"
                >
                  {tab === "api" ? (
                    <ApiSnippet trackId={track.id} />
                  ) : (
                    <LyricsCodeViewer
                      format={tab}
                      code={code}
                      track={track}
                      className="h-full border-white/10"
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
