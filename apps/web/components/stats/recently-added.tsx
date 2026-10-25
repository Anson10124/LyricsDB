import Link from "next/link";
import { Music2 } from "lucide-react";
import type { LibraryRecentTrack } from "@repo/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatArtworkUrl } from "@/lib/artwork";
import { SYNC_TYPES } from "./stats-format";

const relativeTime = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

function formatAddedAt(createdAt: number, now: number): string {
  const elapsed = now - createdAt;
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return relativeTime.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}

function SyncBadge({ lyricsType }: { lyricsType: LibraryRecentTrack["lyricsType"] }) {
  const sync = SYNC_TYPES.find((t) => t.key === (lyricsType ?? "none"))!;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-2.5 rounded-[3px]" style={{ background: sync.color }} />
      {sync.label}
    </span>
  );
}

export function RecentlyAdded({
  tracks,
  now,
}: {
  tracks: LibraryRecentTrack[];
  now: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recently added</CardTitle>
        <CardDescription>The newest tracks in the cache</CardDescription>
      </CardHeader>
      <CardContent>
        {tracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tracks yet</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {tracks.map((track) => {
              const coverUrl = formatArtworkUrl(track.artwork, 120);
              return (
                <li key={track.id}>
                  <Link
                    href={`/track/${track.id}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted">
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={coverUrl}
                          alt={track.album || track.title}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <Music2 className="size-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{track.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {track.artists.join(", ") || "Unknown artist"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <SyncBadge lyricsType={track.lyricsType} />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatAddedAt(track.createdAt, now)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
