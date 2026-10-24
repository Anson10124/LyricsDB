CREATE TABLE IF NOT EXISTS "track_platform_ids" (
  "platform" varchar(16) NOT NULL,
  "platform_id" varchar(64) NOT NULL,
  "track_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "track_platform_ids_platform_platform_id_pk" PRIMARY KEY ("platform", "platform_id"),
  CONSTRAINT "track_platform_ids_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "idx_track_platform_ids_track_id" ON "track_platform_ids" ("track_id");
