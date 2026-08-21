ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "artwork" jsonb;

-- Migrate existing artwork_url and animated_artwork if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracks' AND column_name='artwork_url') THEN
    UPDATE "tracks"
    SET "artwork" = jsonb_strip_nulls(
      jsonb_build_object('url', "artwork_url") || COALESCE("animated_artwork", '{}'::jsonb)
    )
    WHERE "artwork" IS NULL AND ("artwork_url" IS NOT NULL OR "animated_artwork" IS NOT NULL);
  END IF;
END $$;

ALTER TABLE "tracks" DROP COLUMN IF EXISTS "artwork_url";
ALTER TABLE "tracks" DROP COLUMN IF EXISTS "animated_artwork";
ALTER TABLE "tracks" DROP COLUMN IF EXISTS "animated_artwork_url";
ALTER TABLE "tracks" DROP COLUMN IF EXISTS "animated_artwork_tall_url";
