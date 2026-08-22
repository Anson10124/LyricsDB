ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "has_translation" boolean DEFAULT false NOT NULL;
ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "has_romaji" boolean DEFAULT false NOT NULL;
