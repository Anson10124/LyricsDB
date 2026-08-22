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
