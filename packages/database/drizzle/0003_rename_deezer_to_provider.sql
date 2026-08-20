ALTER TABLE "jwt" RENAME COLUMN "deezer" TO "provider";
ALTER TABLE "jwt" DROP COLUMN IF EXISTS "created";
ALTER TABLE "jwt" DROP COLUMN IF EXISTS "updated_at";
ALTER TABLE "jwt" ADD COLUMN IF NOT EXISTS "expire_at" timestamp with time zone NOT NULL;

