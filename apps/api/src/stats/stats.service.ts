import { Inject, Injectable } from "@nestjs/common";
import {
  count,
  DatabaseClient,
  desc,
  gte,
  isNotNull,
  sql,
  tracks,
} from "@repo/database";
import type {
  LibraryDailyStats,
  LibraryPlatform,
  LibraryProviderStats,
  LibraryRecentTrack,
  LibraryStats,
  LibraryStatsTotals,
} from "@repo/types";

import { DATABASE_CONNECTION } from "../database/database.constants";

// Aggregates scan the whole table, so a busy stats page shares one result per window
const STATS_CACHE_TTL_MS = 60_000;
const DAILY_WINDOW_DAYS = 30;
const RECENT_TRACKS_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type TotalsRow = Omit<LibraryStatsTotals, "none"> &
  Record<LibraryPlatform, number>;

interface ProviderRow {
  provider: string | null;
  lyricsType: string | null;
  value: number;
}

interface DailyRow {
  date: string;
  value: number;
}

type RecentRow = Omit<LibraryRecentTrack, "createdAt"> & { createdAt: Date };

const countWhere = (condition: ReturnType<typeof sql>) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

@Injectable()
export class StatsService {
  private cached: { value: LibraryStats; expiresAt: number } | null = null;
  private inFlight: Promise<LibraryStats> | null = null;
  private readonly ttlMs = STATS_CACHE_TTL_MS;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
  ) {}

  public async getStats(): Promise<LibraryStats> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.computeStats()
      .then((value) => {
        this.cached = { value, expiresAt: Date.now() + this.ttlMs };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async computeStats(): Promise<LibraryStats> {
    const now = Date.now();
    const [totals, providerRows, dailyRows, recentRows] = await Promise.all([
      this.queryTotals(),
      this.queryProviderRows(),
      this.queryDailyRows(now),
      this.queryRecentRows(),
    ]);

    const platforms: LibraryPlatform[] = [
      "spotify",
      "appleMusic",
      "deezer",
      "netease",
      "qqMusic",
    ];

    return {
      generatedAt: now,
      totals: {
        tracks: totals.tracks,
        withLyrics: totals.withLyrics,
        word: totals.word,
        line: totals.line,
        plain: totals.plain,
        none: Math.max(totals.tracks - totals.withLyrics, 0),
        translation: totals.translation,
        romaji: totals.romaji,
        verified: totals.verified,
      },
      providers: foldProviderRows(providerRows),
      platforms: platforms.map((platform) => ({
        platform,
        count: totals[platform],
      })),
      dailyAdded: fillDailyRows(dailyRows, now),
      recentlyAdded: recentRows.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).getTime(),
      })),
    };
  }

  private async queryTotals(): Promise<TotalsRow> {
    const [row] = await this.db
      .select({
        tracks: count(),
        withLyrics: count(tracks.lyricsType),
        word: countWhere(sql`${tracks.lyricsType} = 'word'`),
        line: countWhere(sql`${tracks.lyricsType} = 'line'`),
        plain: countWhere(sql`${tracks.lyricsType} = 'plain'`),
        translation: countWhere(sql`${tracks.hasTranslation}`),
        romaji: countWhere(sql`${tracks.hasRomaji}`),
        verified: countWhere(sql`${tracks.isVerified}`),
        spotify: count(tracks.spotifyId),
        appleMusic: count(tracks.appleMusicId),
        deezer: count(tracks.deezerId),
        netease: count(tracks.neteaseId),
        qqMusic: count(tracks.qqMusicId),
      })
      .from(tracks);
    return row as TotalsRow;
  }

  private async queryProviderRows(): Promise<ProviderRow[]> {
    return this.db
      .select({
        provider: tracks.lyricsProvider,
        lyricsType: tracks.lyricsType,
        value: count(),
      })
      .from(tracks)
      .where(isNotNull(tracks.lyricsType))
      .groupBy(tracks.lyricsProvider, tracks.lyricsType);
  }

  private async queryDailyRows(now: number): Promise<DailyRow[]> {
    const day = sql<string>`to_char(${tracks.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    return this.db
      .select({ date: day, value: count() })
      .from(tracks)
      .where(gte(tracks.createdAt, new Date(startOfWindow(now))))
      .groupBy(day);
  }

  private async queryRecentRows(): Promise<RecentRow[]> {
    return this.db
      .select({
        id: tracks.id,
        title: tracks.title,
        artists: tracks.artists,
        album: tracks.album,
        lyricsType: tracks.lyricsType,
        artwork: tracks.artwork,
        createdAt: tracks.createdAt,
      })
      .from(tracks)
      .orderBy(desc(tracks.createdAt))
      .limit(RECENT_TRACKS_LIMIT);
  }
}

function startOfWindow(now: number): number {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return today - (DAILY_WINDOW_DAYS - 1) * DAY_MS;
}

export function foldProviderRows(rows: ProviderRow[]): LibraryProviderStats[] {
  const byProvider = new Map<string, LibraryProviderStats>();
  for (const row of rows) {
    const provider = row.provider || "unknown";
    const entry = byProvider.get(provider) ?? {
      provider,
      total: 0,
      word: 0,
      line: 0,
      plain: 0,
    };
    const value = Number(row.value) || 0;
    entry.total += value;
    if (
      row.lyricsType === "word" ||
      row.lyricsType === "line" ||
      row.lyricsType === "plain"
    ) {
      entry[row.lyricsType] += value;
    }
    byProvider.set(provider, entry);
  }
  return [...byProvider.values()].sort(
    (a, b) => b.total - a.total || a.provider.localeCompare(b.provider),
  );
}

export function fillDailyRows(
  rows: DailyRow[],
  now: number,
): LibraryDailyStats[] {
  const counts = new Map(rows.map((row) => [row.date, Number(row.value) || 0]));
  const start = startOfWindow(now);
  return Array.from({ length: DAILY_WINDOW_DAYS }, (_, i) => {
    const date = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}
