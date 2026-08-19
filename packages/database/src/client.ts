import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export function createDatabaseClient(connectionString?: string) {
  const url =
    connectionString ||
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/lyricsdb';

  const queryClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(queryClient, { schema });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

// Singleton database instance
export const db = createDatabaseClient();
