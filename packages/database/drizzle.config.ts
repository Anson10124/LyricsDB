import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Search for .env in current directory and monorepo root
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

export default defineConfig({
  schema: ["./src/schema/tracks.ts", "./src/schema/jwt.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/lyricsdb",
  },
});
