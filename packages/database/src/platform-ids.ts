import { sql } from "drizzle-orm";
import type { DatabaseClient } from "./client.js";
import { tracks } from "./schema/tracks.js";

// Platform name (as returned by normalizePlatform) -> its primary ID column on `tracks`
export const PLATFORM_ID_COLUMNS = {
  spotify: tracks.spotifyId,
  apple: tracks.appleMusicId,
  deezer: tracks.deezerId,
  netease: tracks.neteaseId,
  qq: tracks.qqMusicId,
  isrc: tracks.isrc,
} as const;

export type PlatformIdKey = keyof typeof PLATFORM_ID_COLUMNS;

export function isPlatformIdKey(platform: string): platform is PlatformIdKey {
  return Object.prototype.hasOwnProperty.call(PLATFORM_ID_COLUMNS, platform);
}

// Copies every primary ID on `tracks` into track_platform_ids. Idempotent: IDs already
// recorded (for this or another track) are left alone. Returns how many rows were added.
export async function backfillTrackPlatformIds(
  db: DatabaseClient,
): Promise<number> {
  const selects = Object.entries(PLATFORM_ID_COLUMNS).map(
    ([platform, column]) =>
      sql`SELECT ${platform}::varchar, ${column}, ${tracks.id} FROM ${tracks} WHERE ${column} IS NOT NULL`,
  );

  const rows = await db.execute<{ inserted: number }>(sql`
    WITH inserted AS (
      INSERT INTO track_platform_ids (platform, platform_id, track_id)
      ${sql.join(selects, sql` UNION ALL `)}
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::int AS inserted FROM inserted
  `);

  return rows[0]?.inserted ?? 0;
}
