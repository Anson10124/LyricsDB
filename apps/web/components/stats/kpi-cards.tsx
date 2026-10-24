import type { LibraryStatsTotals } from "@repo/types";
import { Card, CardContent } from "@/components/ui/card";
import { formatCount, formatPercent } from "./stats-format";

interface Kpi {
  label: string;
  value: string;
  detail: string;
}

export function KpiCards({ totals }: { totals: LibraryStatsTotals }) {
  const kpis: Kpi[] = [
    {
      label: "Tracks cached",
      value: formatCount(totals.tracks),
      detail: `${formatCount(totals.verified)} verified`,
    },
    {
      label: "With lyrics",
      value: formatPercent(totals.withLyrics, totals.tracks),
      detail: `${formatCount(totals.withLyrics)} of ${formatCount(totals.tracks)}`,
    },
    {
      label: "Word-synced",
      value: formatPercent(totals.word, totals.tracks),
      detail: `${formatCount(totals.word)} tracks`,
    },
    {
      label: "Line-synced",
      value: formatPercent(totals.line, totals.tracks),
      detail: `${formatCount(totals.line)} tracks`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.map((kpi) => (
        <Card key={kpi.label} size="sm">
          <CardContent className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{kpi.label}</span>
            <span className="font-heading text-3xl font-semibold tabular-nums tracking-tight">
              {kpi.value}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {kpi.detail}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
