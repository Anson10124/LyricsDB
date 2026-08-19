CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isrc" varchar(12),
	"spotify_id" varchar(64),
	"apple_music_id" varchar(64),
	"deezer_id" varchar(64),
	"netease_id" varchar(64),
	"qq_music_id" varchar(64),
	"title" varchar(500) NOT NULL,
	"artists" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"album" varchar(500),
	"duration_ms" integer NOT NULL,
	"artwork_url" text,
	"lyrics_type" varchar(20),
	"lyrics" jsonb,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracks_isrc" ON "tracks" USING btree ("isrc");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracks_spotify_id" ON "tracks" USING btree ("spotify_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracks_apple_music_id" ON "tracks" USING btree ("apple_music_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracks_deezer_id" ON "tracks" USING btree ("deezer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracks_netease_id" ON "tracks" USING btree ("netease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracks_qq_music_id" ON "tracks" USING btree ("qq_music_id");--> statement-breakpoint
CREATE INDEX "idx_tracks_title" ON "tracks" USING btree ("title");