import { pgTable, serial, text, integer, timestamp, doublePrecision } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  googleId: text('google_id').unique(),
  email: text('email'),
  name: text('name'),
  avatar: text('avatar'),
  age: integer('age').default(30),
  gender: text('gender').default('male'),
  weight: doublePrecision('weight').default(70), // kg
  height: doublePrecision('height').default(170), // cm
  activityLevel: doublePrecision('activity_level').default(1.2),
  targetWeight: doublePrecision('target_weight'),
  targetDate: text('target_date'),
  country: text('country').default('USA'),
  dailyGoal: integer('daily_goal').default(2000),
  createdAt: timestamp('created_at').defaultNow(),
});

export const logs = pgTable('logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  foodName: text('food_name').notNull(),
  calories: integer('calories').notNull(),
  protein: integer('protein'),
  carbs: integer('carbs'),
  fat: integer('fat'),
  imageUrl: text('image_url'),
  sheetId: text('sheet_id'), // Row ID or similar if applicable
  createdAt: timestamp('created_at').defaultNow(),
});

export const workouts = pgTable('workouts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  type: text('type').notNull(),
  caloriesBurned: integer('calories_burned').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const oauthTokens = pgTable('oauth_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiryDate: timestamp('expiry_date'),
});
