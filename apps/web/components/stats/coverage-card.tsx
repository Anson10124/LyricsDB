import type { LibraryStats } from "@repo/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCount, formatPercent, PLATFORM_LABELS, ratio } from "./stats-format";

function MeterRow({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  return (
    <li className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular-nums">
          <span className="font-medium">{formatPercent(value, total)}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {formatCount(value)}
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${ratio(value, total) * 100}%` }}
        />
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  );
}

export function CoverageCard({ stats }: { stats: LibraryStats }) {
  const { totals, platforms } = stats;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Coverage</CardTitle>
        <CardDescription>Share of all cached tracks</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Section title="Extras">
          <MeterRow label="Translation" value={totals.translation} total={totals.tracks} />
          <MeterRow label="Romanization" value={totals.romaji} total={totals.tracks} />
        </Section>
        <Section title="Platform IDs">
          {platforms.map((p) => (
            <MeterRow
              key={p.platform}
              label={PLATFORM_LABELS[p.platform]}
              value={p.count}
              total={totals.tracks}
            />
          ))}
        </Section>
      </CardContent>
    </Card>
  );
}
