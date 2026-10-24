import type { LibraryProviderStats } from "@repo/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatCount,
  formatPercent,
  providerLabel,
  ratio,
  SYNC_TYPES,
} from "./stats-format";

const SEGMENTS = SYNC_TYPES.filter((t) => t.key !== "none");

export function ProviderBreakdown({
  providers,
  withLyrics,
}: {
  providers: LibraryProviderStats[];
  withLyrics: number;
}) {
  const maxTotal = providers[0]?.total ?? 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Lyrics providers</CardTitle>
        <CardDescription>Share of tracks with lyrics, by source</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {SEGMENTS.map(({ key, label, color }) => (
            <span key={key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: color }}
              />
              {label}
            </span>
          ))}
        </div>

        {providers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No lyrics cached yet
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {providers.map((p) => (
              <li
                key={p.provider}
                tabIndex={0}
                className="group relative grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1.5 outline-none hover:bg-muted/60 focus-visible:bg-muted/60 sm:grid-cols-[7rem_1fr_auto]"
              >
                <span className="truncate text-sm">{providerLabel(p.provider)}</span>
                <div className="h-2.5">
                  <div
                    className="flex h-full gap-[2px] overflow-hidden rounded-full"
                    style={{ width: `${ratio(p.total, maxTotal) * 100}%` }}
                  >
                    {SEGMENTS.map(({ key, color }) =>
                      p[key] > 0 ? (
                        <span
                          key={key}
                          className="h-full"
                          style={{ flexGrow: p[key], background: color }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
                <span className="text-right text-sm tabular-nums">
                  <span className="font-medium">
                    {formatPercent(p.total, withLyrics)}
                  </span>
                  <span className="ml-2 inline-block w-8 text-xs text-muted-foreground">
                    {formatCount(p.total)}
                  </span>
                </span>

                <div className="pointer-events-none absolute right-1.5 bottom-full z-10 mb-1 hidden min-w-40 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl group-hover:grid group-focus-visible:grid">
                  <span className="mb-1 font-medium">{providerLabel(p.provider)}</span>
                  {SEGMENTS.map(({ key, label, color }) => (
                    <span key={key} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-2.5 rounded-[2px]"
                          style={{ background: color }}
                        />
                        {label}
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatCount(p[key])}
                      </span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
