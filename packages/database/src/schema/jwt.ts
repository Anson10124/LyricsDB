import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const jwts = pgTable('jwt', {
  provider: varchar('provider', { length: 64 }).primaryKey(),
  token: text('token').notNull(),
  created: timestamp('created', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Jwt = typeof jwts.$inferSelect;
export type NewJwt = typeof jwts.$inferInsert;
