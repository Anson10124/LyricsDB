import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const jwts = pgTable("jwt", {
  provider: varchar("provider", { length: 64 }).primaryKey(),
  token: text("token").notNull(),
  expireAt: timestamp("expire_at", { withTimezone: true }).notNull(),
});

export type Jwt = typeof jwts.$inferSelect;
export type NewJwt = typeof jwts.$inferInsert;
