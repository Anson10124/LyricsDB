ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "needs_enrichment" boolean DEFAULT false NOT NULL;
