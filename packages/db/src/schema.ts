/**
 * Neon Postgres schema — cloud source of truth (PROJECT_PLAN §7).
 * Device SQLite mirrors the log tables; sync queue reconciles (last-write-wins,
 * server timestamp authoritative).
 */
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(), // auth provider subject id
  displayName: text('display_name').notNull().default(''),
  email: text('email'),
  dob: date('dob'),
  sex: text('sex', { enum: ['male', 'female', 'other'] }),
  heightCm: doublePrecision('height_cm'),
  unitPref: text('unit_pref', { enum: ['kg', 'lb'] }).notNull().default('kg'),
  tier: text('tier', { enum: ['starter', 'silver', 'gold', 'elite'] })
    .notNull()
    .default('starter'),
  goalType: text('goal_type', { enum: ['fat_loss', 'muscle', 'strength'] }),
  activityLevel: text('activity_level', {
    enum: ['sedentary', 'light', 'moderate', 'high'],
  }),
  fontScale: text('font_scale', { enum: ['normal', 'large', 'xlarge'] })
    .notNull()
    .default('normal'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const exercises = pgTable('exercises', {
  id: text('id').primaryKey(), // free-exercise-db slug
  name: text('name').notNull(),
  muscleGroup: text('muscle_group').notNull(),
  secondaryMuscles: jsonb('secondary_muscles').$type<string[]>().notNull().default([]),
  equipment: text('equipment'),
  level: text('level'),
  category: text('category'),
  instructions: jsonb('instructions').$type<string[]>().notNull().default([]),
  imageUrls: jsonb('image_urls').$type<string[]>().notNull().default([]),
});

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tierRequired: text('tier_required', {
    enum: ['starter', 'silver', 'gold', 'elite'],
  })
    .notNull()
    .default('starter'),
  goalType: text('goal_type', { enum: ['fat_loss', 'muscle', 'strength'] }).notNull(),
  weeks: integer('weeks').notNull(),
  daysPerWeek: integer('days_per_week').notNull(),
  description: text('description').notNull().default(''),
  isBranded: boolean('is_branded').notNull().default(false),
});

export const planWorkouts = pgTable('plan_workouts', {
  id: text('id').primaryKey(),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  week: integer('week').notNull(),
  day: integer('day').notNull(),
  name: text('name').notNull(),
});

export const planExercises = pgTable('plan_exercises', {
  id: text('id').primaryKey(),
  planWorkoutId: text('plan_workout_id')
    .notNull()
    .references(() => planWorkouts.id, { onDelete: 'cascade' }),
  exerciseId: text('exercise_id')
    .notNull()
    .references(() => exercises.id),
  position: integer('position').notNull().default(0),
  sets: integer('sets').notNull(),
  repRange: text('rep_range').notNull(),
  restSec: integer('rest_sec').notNull().default(120),
});

export const workoutLogs = pgTable('workout_logs', {
  id: text('id').primaryKey(), // client-generated
  userId: text('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  planWorkoutId: text('plan_workout_id').references(() => planWorkouts.id),
  name: text('name').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationSec: integer('duration_sec'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export const setLogs = pgTable('set_logs', {
  id: text('id').primaryKey(),
  workoutLogId: text('workout_log_id')
    .notNull()
    .references(() => workoutLogs.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  exerciseId: text('exercise_id').notNull(),
  exerciseName: text('exercise_name').notNull(),
  setNo: integer('set_no').notNull(),
  weightKg: doublePrecision('weight_kg').notNull(),
  reps: integer('reps').notNull(),
  rpe: doublePrecision('rpe'),
  isPr: boolean('is_pr').notNull().default(false),
  loggedAt: timestamp('logged_at', { withTimezone: true }).notNull(),
});

export const weightLogs = pgTable(
  'weight_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    kg: doublePrecision('kg').notNull(),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('weight_logs_user_date').on(t.userId, t.date)],
);

export const measurements = pgTable('measurements', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  waistCm: doublePrecision('waist_cm'),
  chestCm: doublePrecision('chest_cm'),
  armCm: doublePrecision('arm_cm'),
  hipCm: doublePrecision('hip_cm'),
  thighCm: doublePrecision('thigh_cm'),
});

export const photos = pgTable('photos', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  storagePath: text('storage_path').notNull(), // private bucket, signed URLs
});

export const foods = pgTable('foods', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand'),
  source: text('source', { enum: ['off', 'usda', 'custom', 'seed'] }).notNull(),
  barcode: text('barcode'),
  kcalPer100: doublePrecision('kcal_per_100').notNull(),
  proteinPer100: doublePrecision('protein_per_100').notNull(),
  carbsPer100: doublePrecision('carbs_per_100').notNull(),
  fatPer100: doublePrecision('fat_per_100').notNull(),
  servingGrams: doublePrecision('serving_grams'),
  servingLabel: text('serving_label'),
  createdBy: text('created_by').references(() => profiles.id),
});

export const foodLogs = pgTable('food_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  meal: text('meal', { enum: ['breakfast', 'lunch', 'dinner', 'snacks'] }).notNull(),
  foodId: text('food_id').notNull(),
  foodName: text('food_name').notNull(),
  grams: doublePrecision('grams').notNull(),
  kcal: doublePrecision('kcal').notNull(),
  protein: doublePrecision('protein').notNull(),
  carbs: doublePrecision('carbs').notNull(),
  fat: doublePrecision('fat').notNull(),
  loggedAt: timestamp('logged_at', { withTimezone: true }).notNull(),
});

export const waterLogs = pgTable(
  'water_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    ml: integer('ml').notNull().default(0),
  },
  (t) => [uniqueIndex('water_logs_user_date').on(t.userId, t.date)],
);

export const targets = pgTable('targets', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  kcal: integer('kcal').notNull(),
  protein: integer('protein').notNull(),
  carbs: integer('carbs').notNull(),
  fat: integer('fat').notNull(),
  waterMl: integer('water_ml').notNull(),
  activeFrom: date('active_from').notNull(),
});

export const streaks = pgTable('streaks', {
  userId: text('user_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  current: integer('current').notNull().default(0),
  best: integer('best').notNull().default(0),
  lastWorkoutDate: date('last_workout_date'),
});

export const buddies = pgTable('buddies', {
  id: text('id').primaryKey(),
  userA: text('user_a')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  userB: text('user_b')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'accepted', 'blocked'] })
    .notNull()
    .default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const buddyEvents = pgTable('buddy_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // workout_started, pr, nudge, ...
  actorId: text('actor_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  targetId: text('target_id').references(() => profiles.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  userId: text('user_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  rcCustomerId: text('rc_customer_id'),
  tier: text('tier', { enum: ['starter', 'silver', 'gold', 'elite'] })
    .notNull()
    .default('starter'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

/** Email/password + Google accounts (auth lives in apps/web API routes). */
export const accounts = pgTable('accounts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(), // stored lowercase
  passwordHash: text('password_hash'), // 'scrypt$<saltHex>$<hashHex>' — null for Google-only accounts
  googleSub: text('google_sub').unique(), // Google OIDC subject id — null for password accounts
  displayName: text('display_name').notNull().default(''),
  tier: text('tier', { enum: ['starter', 'silver', 'gold', 'elite'] })
    .notNull()
    .default('starter'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Opaque 64-char hex session tokens, 30-day expiry. */
export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/**
 * Gym Buddy Sync — pairs of accounts (auth-backed, unlike the legacy
 * profiles-based `buddies` table). One row per invite; direction matters
 * until accepted.
 */
export const buddyLinks = pgTable(
  'buddy_links',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    requesterId: text('requester_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('buddy_links_requester_addressee').on(t.requesterId, t.addresseeId)],
);

/**
 * Buddy activity feed — workout completions, PRs, nudges.
 * targetId null = visible to all accepted buddies; set = directed (nudge).
 */
export const buddyActivity = pgTable(
  'buddy_activity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'workout_completed' | 'nudge' | 'pr' | 'live_session'
    targetId: text('target_id').references(() => accounts.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('buddy_activity_account_created').on(t.accountId, t.createdAt)],
);

/**
 * Buddy live workout sessions — a host starts a session and accepted
 * buddies with the same subscription tier can join in real time.
 */
export const buddySessions = pgTable(
  'buddy_sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    hostId: text('host_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    workoutName: text('workout_name').notNull(),
    status: text('status', { enum: ['active', 'ended'] })
      .notNull()
      .default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('buddy_sessions_host').on(t.hostId, t.startedAt)],
);

export const buddySessionParticipants = pgTable(
  'buddy_session_participants',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text('session_id')
      .notNull()
      .references(() => buddySessions.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('buddy_session_participants_session_account').on(t.sessionId, t.accountId)],
);

/**
 * Referral system — track invitations sent to friends. When the invitee
 * signs up and becomes active, both referrer and invitee earn a discount.
 */
export const referrals = pgTable(
  'referrals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    referrerId: text('referrer_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    inviteeEmail: text('invitee_email').notNull(),
    inviteeId: text('invitee_id').references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'joined', 'rewarded'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('referrals_referrer_email').on(t.referrerId, t.inviteeEmail)],
);

/**
 * Trial usage — one 2-day trial per account per tier. Prevents abuse
 * by tracking which tiers have been trialed.
 */
export const trialUsage = pgTable(
  'trial_usage',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tier: text('tier', { enum: ['silver', 'gold', 'elite'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('trial_usage_account_tier').on(t.accountId, t.tier)],
);

/**
 * Cloud profile backup — the mobile app's profile store (onboarding answers,
 * targets, preferences) as one JSON blob per account. Restored on sign-in so
 * a returning user never re-runs setup; pushed on every profile change.
 */
export const accountProfiles = pgTable('account_profiles', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Expo push tokens — one row per registered device. A single token maps to
 * exactly one account, so re-registering the same token upserts (a device that
 * signs into a different account moves the token). Buddy events (invite,
 * accept, nudge) fan out to these so a user is notified even with the app closed.
 */
export const devicePushTokens = pgTable(
  'device_push_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    token: text('token').notNull(), // "ExponentPushToken[...]"
    platform: text('platform', { enum: ['ios', 'android'] }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('device_push_tokens_token').on(t.token)],
);
