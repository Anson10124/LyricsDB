import type {
  ArtworkMetadata,
  LyricsType,
  SyncedLyricsPayload,
} from "@repo/types";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // International Standard Recording Code (12 chars standard)
    isrc: varchar("isrc", { length: 12 }),

    // External Streaming Platform IDs
    spotifyId: varchar("spotify_id", { length: 64 }),
    appleMusicId: varchar("apple_music_id", { length: 64 }),
    deezerId: varchar("deezer_id", { length: 64 }),
    neteaseId: varchar("netease_id", { length: 64 }),
    qqMusicId: varchar("qq_music_id", { length: 64 }),

    // Track Metadata
    title: varchar("title", { length: 500 }).notNull(),
    artists: jsonb("artists").$type<string[]>().default([]).notNull(),
    album: varchar("album", { length: 500 }),
    durationMs: integer("duration_ms").notNull(),
    artwork: jsonb("artwork").$type<ArtworkMetadata>(),

    // Lyrics Content & Sync Type & Provider
    // lyricsType: 'word' | 'line' | 'plain' | null
    // lyrics: JSONB structured payload or string (null if offloaded to object storage)
    // lyricsStoragePath: object storage key path (e.g. 'lyrics/UUID.json')
    // lyricsProvider: 'netease-yrc' | 'lrclib' | etc.
    lyricsType: varchar("lyrics_type", { length: 20 }).$type<LyricsType>(),
    lyrics: jsonb("lyrics").$type<
      SyncedLyricsPayload | string | Record<string, unknown>
    >(),
    lyricsStoragePath: text("lyrics_storage_path"),
    lyricsProvider: varchar("lyrics_provider", { length: 100 }),

    // Translation and Romaji (Romanization) Metadata
    hasTranslation: boolean("has_translation").default(false).notNull(),
    hasRomaji: boolean("has_romaji").default(false).notNull(),

    // Verification Flag (defaults to false for human review)
    isVerified: boolean("is_verified").default(false).notNull(),

    // Imported (from AMLL TTML DB) without platform metadata such as artwork or
    // the real duration; the first request fills it in with a live resolve
    needsEnrichment: boolean("needs_enrichment").default(false).notNull(),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Unique Partial Indexes: Indexes non-null values for fast O(1) lookups
    uniqueIndex("idx_tracks_isrc").on(table.isrc),
    uniqueIndex("idx_tracks_spotify_id").on(table.spotifyId),
    uniqueIndex("idx_tracks_apple_music_id").on(table.appleMusicId),
    uniqueIndex("idx_tracks_deezer_id").on(table.deezerId),
    uniqueIndex("idx_tracks_netease_id").on(table.neteaseId),
    uniqueIndex("idx_tracks_qq_music_id").on(table.qqMusicId),

    // Search index on title
    index("idx_tracks_title").on(table.title),
  ],
);

export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;

// Every platform ID (and ISRC) ever seen for a track. The per-platform columns on
// `tracks` hold one primary ID each; catalogs list the same recording many times
// (single, album, compilation, re-uploads), so the other IDs resolve through here.
export const trackPlatformIds = pgTable(
  "track_platform_ids",
  {
    // normalizePlatform() names: 'spotify' | 'apple' | 'deezer' | 'netease' | 'qq' | 'isrc'
    platform: varchar("platform", { length: 16 }).notNull(),
    platformId: varchar("platform_id", { length: 64 }).notNull(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // One ID belongs to exactly one track; doubles as the lookup index
    primaryKey({ columns: [table.platform, table.platformId] }),
    index("idx_track_platform_ids_track_id").on(table.trackId),
  ],
);

export type TrackPlatformId = typeof trackPlatformIds.$inferSelect;
export type NewTrackPlatformId = typeof trackPlatformIds.$inferInsert;

// What a track looked like before a community edit, so a bad edit can be rolled
// back (see apps/api/scripts/revert-track-edit.mts). Written before the edit is saved.
export interface TrackRevisionSnapshot {
  lyrics: SyncedLyricsPayload | string | Record<string, unknown> | null;
  lyricsType: LyricsType | null;
  lyricsProvider: string | null;
  hasTranslation: boolean;
  hasRomaji: boolean;
  isVerified: boolean;
  ids: {
    isrc: string | null;
    spotifyId: string | null;
    appleMusicId: string | null;
    deezerId: string | null;
    neteaseId: string | null;
    qqMusicId: string | null;
  };
}

export const trackRevisions = pgTable(
  "track_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    previous: jsonb("previous").$type<TrackRevisionSnapshot>().notNull(),
    // Which parts the edit changed: 'lyrics' and/or 'ids'
    changed: jsonb("changed").$type<string[]>().default([]).notNull(),
    // Salted hash of the editor's IP, to spot repeat vandalism without storing IPs
    editorHash: varchar("editor_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_track_revisions_track_id").on(table.trackId)],
);

export type TrackRevision = typeof trackRevisions.$inferSelect;

// Platform IDs a person removed from a track because the match was wrong. A later
// resolve never attaches them to that track again.
export const trackRejectedPlatformIds = pgTable(
  "track_rejected_platform_ids",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    // normalizePlatform() names, as in track_platform_ids
    platform: varchar("platform", { length: 16 }).notNull(),
    platformId: varchar("platform_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.trackId, table.platform, table.platformId] }),
  ],
);
