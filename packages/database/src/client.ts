import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

// Load .env from root if not already loaded into process.env
if (!process.env.DATABASE_URL) {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../.env"),
  ];
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      config({ path: envPath });
      break;
    }
  }
}

export function createDatabaseClient(connectionString?: string) {
  const url =
    connectionString ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/lyricsdb";

  const isTransactionPooler =
    process.env.DATABASE_PREPARE === "false" ||
    url.includes(":6543") ||
    url.includes("pgbouncer=true") ||
    url.includes("pooler.supabase.com");

  const isSslRequired =
    process.env.DATABASE_SSL === "true" ||
    process.env.DATABASE_SSL === "require" ||
    url.includes("sslmode=require") ||
    url.includes("supabase.co") ||
    url.includes("supabase.com");

  const queryClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !isTransactionPooler,
    ssl: isSslRequired ? "require" : undefined,
  });

  return drizzle(queryClient, { schema });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

// Singleton database instance
export const db = createDatabaseClient();
