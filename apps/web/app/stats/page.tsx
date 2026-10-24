"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw } from "lucide-react";
import type { LibraryStats } from "@repo/types";
import { fetchLibraryStats } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { KpiCards } from "@/components/stats/kpi-cards";
import { SyncTypeChart } from "@/components/stats/sync-type-chart";
import { ProviderBreakdown } from "@/components/stats/provider-breakdown";
import { TracksOverTimeChart } from "@/components/stats/tracks-over-time-chart";
import { CoverageCard } from "@/components/stats/coverage-card";

const updatedAt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} size="sm" className="h-[106px] animate-pulse" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="h-80 animate-pulse md:col-span-2" />
        <Card className="h-80 animate-pulse md:col-span-3" />
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="h-80 animate-pulse md:col-span-3" />
        <Card className="h-80 animate-pulse md:col-span-2" />
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await fetchLibraryStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Link
              href="/"
              className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to search
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Library stats
            </h1>
            <p className="text-sm text-muted-foreground">
              What&apos;s in the LyricsDB cache right now
            </p>
          </div>
          {stats && (
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 cursor-pointer"
            >
              <RotateCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
              Updated {updatedAt.format(stats.generatedAt)}
            </button>
          )}
        </header>

        {error && !stats ? (
          <Card className="items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              Try again
            </button>
          </Card>
        ) : !stats ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-4">
            <KpiCards totals={stats.totals} />
            <div className="grid gap-4 md:grid-cols-5">
              <div className="md:col-span-2">
                <SyncTypeChart totals={stats.totals} />
              </div>
              <div className="md:col-span-3">
                <ProviderBreakdown
                  providers={stats.providers}
                  withLyrics={stats.totals.withLyrics}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-5">
              <div className="md:col-span-3">
                <TracksOverTimeChart
                  days={stats.dailyAdded}
                  total={stats.totals.tracks}
                />
              </div>
              <div className="md:col-span-2">
                <CoverageCard stats={stats} />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
