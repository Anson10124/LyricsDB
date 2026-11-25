CREATE TABLE IF NOT EXISTS "track_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "track_id" uuid NOT NULL,
  "previous" jsonb NOT NULL,
  "changed" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "editor_hash" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "track_revisions_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "idx_track_revisions_track_id" ON "track_revisions" ("track_id");

CREATE TABLE IF NOT EXISTS "track_rejected_platform_ids" (
  "track_id" uuid NOT NULL,
  "platform" varchar(16) NOT NULL,
  "platform_id" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "track_rejected_platform_ids_track_id_platform_platform_id_pk" PRIMARY KEY ("track_id", "platform", "platform_id"),
  CONSTRAINT "track_rejected_platform_ids_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action
);
