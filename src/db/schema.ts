import { pgTable, serial, text, integer, timestamp, doublePrecision } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  googleId: text('google_id').unique(),
  email: text('email'),
  name: text('name'),
  avatar: text('avatar'),
  age: integer('age').default(30),
  weight: doublePrecision('weight').default(70), // kg
  height: doublePrecision('height').default(170), // cm
  dailyGoal: integer('daily_goal').default(2000),
  createdAt: timestamp('created_at').defaultNow(),
});

export const logs = pgTable('logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  foodName: text('food_name').notNull(),
  calories: integer('calories').notNull(),
  imageUrl: text('image_url'),
  sheetId: text('sheet_id'), // Row ID or similar if applicable
  createdAt: timestamp('created_at').defaultNow(),
});

export const oauthTokens = pgTable('oauth_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiryDate: timestamp('expiry_date'),
});
