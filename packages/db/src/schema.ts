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
  // Dated subscriptions. Both nullable so existing rows and db:push are safe.
  //  - tierStartedAt: when the current tier took effect (audit/history).
  //  - tierExpiresAt: null = no expiry (permanent/free). A past timestamp means
  //    the paid tier has lapsed; the account keeps `tier` (for history and
  //    one-click reactivation) but effectiveTier() collapses it to 'starter' at
  //    the auth choke point — so an expired Elite loses access with NO cron.
  tierStartedAt: timestamp('tier_started_at', { withTimezone: true }),
  tierExpiresAt: timestamp('tier_expires_at', { withTimezone: true }),
  // 'suspended' kills every session for this account at the auth choke point
  // (userForToken filters on status='active'). Defaulted so existing rows and
  // the mobile GET/POST are unaffected.
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
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

/**
 * Elite coach messaging — the real feature behind the Elite promise. One table
 * serves two async threads per account, split by `kind`:
 *  - 'coach_chat' → 1-on-1 messages with Greece,
 *  - 'support'    → Elite priority support tickets.
 * `sender` marks who wrote the row (the user, or Greece/the GM team as 'coach').
 * No real-time: the app loads a thread on focus and appends optimistically; an
 * auto-acknowledgement coach row makes the thread feel alive until a real
 * coach reply lands (future admin panel). `readByUser` is reserved for an
 * unread badge; the auto-ack is authored as 'coach' and starts unread.
 */
export const coachMessages = pgTable(
  'coach_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['coach_chat', 'support'] }).notNull(),
    sender: text('sender', { enum: ['user', 'coach'] }).notNull(),
    body: text('body').notNull(),
    // Which human staff account authored a 'coach' row. Null = AI/system
    // (greeceCoachReply / auto-ack). Nullable so the mobile POST that inserts
    // AI replies keeps working unchanged.
    senderAccountId: text('sender_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    // Coach-console unread badge, mirror of readByUser for the other side.
    readByCoach: boolean('read_by_coach').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readByUser: boolean('read_by_user').notNull().default(false),
  },
  (t) => [index('coach_messages_account_kind_created').on(t.accountId, t.kind, t.createdAt)],
);

/**
 * RBAC / coach foundation (keyed on accounts.id, NOT the legacy profiles.id).
 * Presence of an `admins` row = this account is staff. Roles are hardcoded in
 * the guard layer (apps/web/src/lib/authz.ts) for the minimal CTO cut — no
 * data-driven permission engine yet.
 */
export const admins = pgTable('admins', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  role: text('role', {
    enum: [
      'super_admin',
      'main_admin',
      'member_admin',
      'nutrition_admin',
      'content_admin',
      'support_admin',
      'coach',
    ],
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Coach ↔ user roster. A coach can only act on users assigned to them
 * (checked in requireCoachOwnsUser). One active row per (coach,user) pair.
 */
export const coachAssignments = pgTable(
  'coach_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['active', 'ended'] })
      .notNull()
      .default('active'),
    assignedBy: text('assigned_by')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('coach_assignments_coach_user').on(t.coachId, t.userId),
    index('coach_assignments_user').on(t.userId),
    index('coach_assignments_coach_status').on(t.coachId, t.status),
  ],
);

/** Public-facing coach identity + capacity settings. */
export const coachProfiles = pgTable('coach_profiles', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull().default(''),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url'),
  acceptingClients: boolean('accepting_clients').notNull().default(true),
  replyWindowHours: integer('reply_window_hours').notNull().default(24),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only audit trail for staff actions. actorId is SET NULL on account
 * delete so the log survives the actor. `meta` is free-form JSON context.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    actorId: text('actor_id').references(() => accounts.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // e.g. 'coach.message.user', 'account.suspend'
    targetType: text('target_type').notNull(), // e.g. 'account', 'coach_message'
    targetId: text('target_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_actor_created').on(t.actorId, t.createdAt),
    index('audit_log_target').on(t.targetType, t.targetId),
  ],
);

/**
 * Exercise/plan demonstration videos hosted on Cloudflare Stream. Gated by
 * subscription tier (default 'gold'). `providerVideoId` stores the Cloudflare
 * Stream uid ONLY — never a public/signed URL — so playback URLs are minted
 * server-side per request. exerciseId/planId are both nullable so a video can
 * attach to an exercise, a plan, or stand alone.
 */
export const planVideos = pgTable(
  'plan_videos',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    exerciseId: text('exercise_id').references(() => exercises.id, { onDelete: 'set null' }),
    planId: text('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    tierRequired: text('tier_required', {
      enum: ['starter', 'silver', 'gold', 'elite'],
    })
      .notNull()
      .default('gold'),
    provider: text('provider').notNull().default('cf_stream'),
    providerVideoId: text('provider_video_id').notNull(), // Cloudflare Stream uid — never a public URL
    thumbnailUrl: text('thumbnail_url'),
    durationSec: integer('duration_sec'),
    position: integer('position').notNull().default(0),
    // Successful signed-playback mints (tier-allowed 200s). Incremented atomically
    // and best-effort in the playback route — never blocks playback. Defaulted so
    // existing rows read 0 and db:push is safe.
    views: integer('views').notNull().default(0),
    status: text('status', { enum: ['processing', 'ready', 'removed'] })
      .notNull()
      .default('processing'),
    createdBy: text('created_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plan_videos_tier_status_position').on(t.tierRequired, t.status, t.position),
    index('plan_videos_exercise').on(t.exerciseId),
  ],
);

/**
 * One-way, append-only workout backup from the device (accounts-keyed).
 * The legacy `workoutLogs`/`setLogs` tables FK to profiles.id (auth-less
 * identity) and stay untouched — bearer-authed sync lands HERE. `id` is the
 * client-generated UUID and doubles as the idempotency key: the sync route
 * upserts with ON CONFLICT DO NOTHING, so a replayed batch is harmless.
 */
export const syncedWorkouts = pgTable(
  'synced_workouts',
  {
    id: text('id').primaryKey(), // client-generated UUID — idempotency key
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    name: text('name').notNull(),
    templateId: text('template_id'),
    templateName: text('template_name'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    durationSec: integer('duration_sec'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('synced_workouts_account_date').on(t.accountId, t.date)],
);

export const syncedSets = pgTable(
  'synced_sets',
  {
    id: text('id').primaryKey(), // client-generated UUID
    workoutId: text('workout_id')
      .notNull()
      .references(() => syncedWorkouts.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id').notNull(),
    exerciseName: text('exercise_name').notNull(),
    setNo: integer('set_no').notNull(),
    weightKg: doublePrecision('weight_kg').notNull(), // canonical kg always
    weightUnit: text('weight_unit', { enum: ['kg', 'lb'] }).notNull().default('kg'), // user's display unit
    reps: integer('reps').notNull(),
    rpe: doublePrecision('rpe'),
    isWarmup: boolean('is_warmup').notNull().default(false), // local schema has no flag yet; reserved
    isPr: boolean('is_pr').notNull().default(false),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('synced_sets_account_exercise_logged').on(t.accountId, t.exerciseId, t.loggedAt)],
);

/**
 * Client-computed progression suggestions awaiting/holding coach review.
 * One row per (account, exercise, source workout); the mobile app posts them
 * after a workout syncs, the coach console approves or adjusts, and mobile
 * renders reviewed rows with a "Reviewed by your coach" badge.
 */
export const progressionSuggestions = pgTable(
  'progression_suggestions',
  {
    id: text('id').primaryKey(), // client-generated UUID
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id').notNull(),
    exerciseName: text('exercise_name').notNull(),
    sourceWorkoutId: text('source_workout_id').notNull(), // synced workout the suggestion was computed after
    action: text('action', { enum: ['increase', 'hold', 'deload'] }).notNull(),
    targetWeightKg: doublePrecision('target_weight_kg').notNull(),
    targetRepsMin: integer('target_reps_min').notNull(),
    targetRepsMax: integer('target_reps_max').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'adjusted'] })
      .notNull()
      .default('pending'),
    coachId: text('coach_id').references(() => accounts.id, { onDelete: 'set null' }),
    adjustedWeightKg: doublePrecision('adjusted_weight_kg'),
    coachNote: text('coach_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('progression_suggestions_account_exercise_source').on(
      t.accountId,
      t.exerciseId,
      t.sourceWorkoutId,
    ),
    index('progression_suggestions_account_status').on(t.accountId, t.status, t.createdAt),
  ],
);

/**
 * Weekly coach check-ins (distinct from the local GM WeeklyCheckIn feature).
 * One per account per day; `summary` is the client-computed week recap and
 * `coachReplyMessageId` links the coach's reply row in coach_messages so the
 * mobile thread renders it with zero changes.
 */
export const checkIns = pgTable(
  'check_ins',
  {
    id: text('id').primaryKey(), // client-generated UUID
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    bodyweightKg: doublePrecision('bodyweight_kg'),
    sleep: integer('sleep').notNull(), // 1-5
    energy: integer('energy').notNull(), // 1-5
    soreness: integer('soreness').notNull(), // 1-5
    note: text('note').notNull().default(''),
    summary: jsonb('summary')
      .$type<{ sessions: number; volumeKg: number; prCount: number }>()
      .notNull()
      .default({ sessions: 0, volumeKg: 0, prCount: 0 }),
    coachReplyMessageId: text('coach_reply_message_id').references(() => coachMessages.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('check_ins_account_date').on(t.accountId, t.date),
    index('check_ins_account_created').on(t.accountId, t.createdAt),
  ],
);
