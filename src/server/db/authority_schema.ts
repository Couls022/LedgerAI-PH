import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const authorityUsers = sqliteTable('authority_users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});
