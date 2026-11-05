"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { LibraryStats } from "@repo/types";
import { fetchLibraryStats } from "@/lib/api-client";
import { fade, rise, spring, stagger } from "@/lib/motion";
import { CountUp } from "@/components/home/count-up";

const percent = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

function StatsStrip({ stats }: { stats: LibraryStats }) {
  const { totals } = stats;
  const items = [
    { label: "tracks", value: totals.tracks, suffix: "" },
    {
      label: "word-synced",
      value: percent(totals.word, totals.tracks),
      suffix: "%",
    },
    {
      label: "with translation",
      value: percent(totals.translation, totals.tracks),
      suffix: "%",
    },
    { label: "sources", value: stats.providers.length, suffix: "" },
  ];

  return (
    <motion.div
      variants={stagger(0.07)}
      initial="hidden"
      animate="show"
      className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3"
    >
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          variants={rise}
          className="flex items-baseline gap-1.5"
        >
          <span className="text-2xl font-bold tracking-tight text-foreground">
            <CountUp value={item.value} suffix={item.suffix} delay={i * 0.07} />
          </span>
          <span className="text-sm text-muted-foreground">{item.label}</span>
        </motion.div>
      ))}
    </motion.div>
  );
}

interface LibraryShowcaseProps {
  // Fades out while the search dropdown is open so results stay readable
  dimmed?: boolean;
}

export function LibraryShowcase({ dimmed = false }: LibraryShowcaseProps) {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLibraryStats()
      .then((data) => active && setStats(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{
        opacity: dimmed ? 0 : 1,
        y: dimmed ? 12 : 0,
      }}
      transition={{ ...spring.soft, opacity: fade }}
      aria-hidden={dimmed}
      className={`w-full max-w-6xl px-4 ${dimmed ? "pointer-events-none" : ""}`}
    >
      {/* min-h reserves the strip's height so the hero doesn't jump when stats load */}
      <div className="min-h-9">{stats && <StatsStrip stats={stats} />}</div>
    </motion.section>
  );
}
