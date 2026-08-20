"use client";

import { useState } from "react";

export interface TaskProgressState {
  metaStatus: "pending" | "running" | "done" | "failed";
  metaData?: {
    title?: string;
    artist?: string;
    artists?: string[];
    durationMs?: number;
    artworkUrl?: string;
    platform?: string;
    id?: string;
  };
  platformsStatus: "pending" | "running" | "done" | "failed";
  matchedPlatforms: Array<{ platform: string; id: string; score?: number }>;
  searchingPlatforms: string[];
  lyricsStatus: "pending" | "running" | "done" | "failed";
  lyricsSearchingProviders: Array<{ provider: string; status: "searching" | "found" | "not_found" }>;
  lyricsResult?: { provider?: string; lyricsType?: string; hasLyrics?: boolean };
  saveStatus: "pending" | "running" | "done" | "failed";
}

function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const size = 24, stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="absolute inset-0"
        style={active ? { animation: "spin 1.1s linear infinite" } : undefined}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-border/60" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-primary"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-foreground">{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: "red" | "green"; children: React.ReactNode }) {
  return (
    <span
      className={`flex size-5.5 shrink-0 items-center justify-center rounded-full text-white shadow-xs
        ${tone === "red" ? "bg-red-500" : "bg-emerald-500"}`}
      style={{ animation: "pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const CheckIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const RetryIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </svg>
);

function formatDuration(ms?: number): string {
  if (!ms) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TaskRows({ progress }: { progress: TaskProgressState }) {
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  // Format platform details
  const platformDetails = progress.matchedPlatforms.map((p) => ({
    label: p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
    meta: `ID: ${p.id.slice(0, 10)}${p.id.length > 10 ? "..." : ""}`,
  }));

  if (progress.searchingPlatforms.length > 0 && progress.platformsStatus === "running") {
    progress.searchingPlatforms.forEach((p) => {
      if (!progress.matchedPlatforms.some((m) => m.platform === p)) {
        platformDetails.push({
          label: p.charAt(0).toUpperCase() + p.slice(1),
          meta: "searching...",
        });
      }
    });
  }

  // Format lyrics details
  const lyricsDetails = progress.lyricsSearchingProviders.map((p) => ({
    label: p.provider.toUpperCase(),
    meta: p.status === "found" ? "matched ✓" : p.status === "searching" ? "checking..." : "not found",
  }));

  const rows = [
    {
      key: "meta",
      badge:
        progress.metaStatus === "done" ? (
          <Badge tone="green">{CheckIcon}</Badge>
        ) : progress.metaStatus === "failed" ? (
          <Badge tone="red">{XIcon}</Badge>
        ) : (
          <SpinnerRing active={progress.metaStatus === "running"}>1</SpinnerRing>
        ),
      label: progress.metaData?.title
        ? `${progress.metaData.title} - ${progress.metaData.artist || ""}`
        : "Extract track metadata",
      amount: progress.metaData?.durationMs ? formatDuration(progress.metaData.durationMs) : "",
      pill:
        progress.metaStatus === "done" ? (
          <span className="inline-flex h-5.5 items-center rounded-full bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
            Resolved
          </span>
        ) : progress.metaStatus === "running" ? (
          <span className="inline-flex h-5.5 items-center rounded-full bg-primary/10 px-2 text-[11.5px] font-medium text-primary">
            Parsing
          </span>
        ) : null,
      details: [
        { label: "Title", meta: progress.metaData?.title || "Pending..." },
        { label: "Artists", meta: progress.metaData?.artists?.join(", ") || progress.metaData?.artist || "Pending..." },
        ...(progress.metaData?.durationMs
          ? [{ label: "Duration", meta: formatDuration(progress.metaData.durationMs) }]
          : []),
      ],
    },
    {
      key: "platforms",
      badge:
        progress.platformsStatus === "done" ? (
          <Badge tone="green">{CheckIcon}</Badge>
        ) : progress.platformsStatus === "failed" ? (
          <Badge tone="red">{XIcon}</Badge>
        ) : (
          <SpinnerRing active={progress.platformsStatus === "running"}>2</SpinnerRing>
        ),
      label: "Cross-platform matching",
      amount:
        progress.matchedPlatforms.length > 0
          ? `${progress.matchedPlatforms.length} matched`
          : progress.platformsStatus === "running"
          ? "searching..."
          : "",
      pill:
        progress.platformsStatus === "done" ? (
          <span className="inline-flex h-5.5 items-center rounded-full bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
            Matched
          </span>
        ) : progress.platformsStatus === "running" ? (
          <span className="inline-flex h-5.5 items-center rounded-full bg-primary/10 px-2 text-[11.5px] font-medium text-primary">
            Matching
          </span>
        ) : null,
      details: platformDetails.length > 0 ? platformDetails : [{ label: "Platform links", meta: "Searching..." }],
    },
    {
      key: "lyrics",
      badge:
        progress.lyricsStatus === "done" ? (
          <Badge tone="green">{CheckIcon}</Badge>
        ) : progress.lyricsStatus === "failed" ? (
          <Badge tone="red">{XIcon}</Badge>
        ) : (
          <SpinnerRing active={progress.lyricsStatus === "running"}>3</SpinnerRing>
        ),
      label: "Discover synced lyrics",
      amount: progress.lyricsResult?.provider ? progress.lyricsResult.provider.toUpperCase() : "",
      pill:
        progress.lyricsStatus === "done" ? (
          <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
            {progress.lyricsResult?.lyricsType ? `${progress.lyricsResult.lyricsType}-sync` : "Found"}
          </span>
        ) : progress.lyricsStatus === "failed" ? (
          <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-red-500/10 px-2 text-[11.5px] font-medium text-red-500">
            No lyrics <span className="flex">{RetryIcon}</span>
          </span>
        ) : progress.lyricsStatus === "running" ? (
          <span className="inline-flex h-5.5 items-center rounded-full bg-primary/10 px-2 text-[11.5px] font-medium text-primary">
            Searching
          </span>
        ) : null,
      details:
        lyricsDetails.length > 0 ? lyricsDetails : [{ label: "Providers (QQ, Deezer, NetEase, Musixmatch, LRCLIB)", meta: "Pending..." }],
    },
    {
      key: "save",
      badge:
        progress.saveStatus === "done" ? (
          <Badge tone="green">{CheckIcon}</Badge>
        ) : progress.saveStatus === "failed" ? (
          <Badge tone="red">{XIcon}</Badge>
        ) : (
          <SpinnerRing active={progress.saveStatus === "running"}>4</SpinnerRing>
        ),
      label: "Store & index track",
      amount: progress.saveStatus === "done" ? "Cached" : "",
      pill:
        progress.saveStatus === "done" ? (
          <span className="inline-flex h-5.5 items-center rounded-full bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
            Completed
          </span>
        ) : null,
      details: [{ label: "Database status", meta: progress.saveStatus === "done" ? "Saved to Postgres" : "Pending..." }],
    },
  ];

  return (
    <div className="flex w-full max-w-lg flex-col gap-2 min-h-[220px]">
      {rows.map((row, i) => {
        // Auto-open row if currently active or manually toggled
        const isActive =
          (row.key === "meta" && progress.metaStatus === "running") ||
          (row.key === "platforms" && progress.platformsStatus === "running") ||
          (row.key === "lyrics" && progress.lyricsStatus === "running") ||
          (row.key === "save" && progress.saveStatus === "running");

        const open = manualOpen[row.key] ?? isActive;

        return (
          <div
            key={row.key}
            className="self-stretch overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm transition-[border-radius,background-color] duration-300 hover:bg-card/100"
            style={{
              borderRadius: open ? 16 : 20,
              animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
            }}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setManualOpen((current) => ({ ...current, [row.key]: !open }))}
              className="flex h-12 w-full items-center gap-2.5 px-3 text-left cursor-pointer"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                {row.badge}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                {row.label}
              </span>
              <span className="text-[12px] text-muted-foreground tabular-nums">{row.amount}</span>
              {row.pill}
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-transform duration-300"
                  style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {/* dropdown detail */}
            <div
              className="grid transition-[grid-template-rows,opacity] duration-300"
              style={{
                gridTemplateRows: open ? "1fr" : "0fr",
                opacity: open ? 1 : 0,
                transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
              }}
            >
              <div className="overflow-hidden">
                <div className="mb-3 grid grid-cols-[24px_1fr] gap-2 px-3">
                  <span aria-hidden className="mx-auto h-full w-px bg-border/80" />
                  <div className="flex flex-col gap-1.5 pt-0.5">
                    {row.details.map((d, j) => (
                      <div
                        key={d.label + j}
                        className="flex items-center justify-between"
                        style={
                          open
                            ? { animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${100 + j * 60}ms both` }
                            : undefined
                        }
                      >
                        <span className="text-[12px] text-muted-foreground">{d.label}</span>
                        <span className="font-mono text-[11.5px] text-foreground/80 tabular-nums truncate max-w-[200px]">
                          {d.meta}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
