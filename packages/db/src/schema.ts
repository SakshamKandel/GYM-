/**
 * Neon Postgres schema — cloud source of truth (PROJECT_PLAN §7).
 * Device SQLite mirrors the log tables; sync queue reconciles (last-write-wins,
 * server timestamp authoritative).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  // Provenance of the CURRENT tier grant — lets the RevenueCat webhook avoid
  // clobbering an admin/manual Nepal grant (B4): the webhook only downgrades
  // tiers it granted ('revenuecat'), skipping 'manual_payment'/'console' while
  // the window is still future. 'preview' = signed-out/local preview grant,
  // 'coach' = coach-initiated client comp. Nullable — legacy rows predate it.
  tierSource: text('tier_source', {
    enum: ['console', 'manual_payment', 'revenuecat', 'preview', 'coach'],
  }),
  // Natural id of the grant currently represented by tierSource. Manual
  // payments store payment_requests.id; RevenueCat stores event.id. Refunds
  // and webhook retries use it to prove they still own the live tier before
  // changing it.
  tierSourceId: text('tier_source_id'),
  // Latest RevenueCat event generation time observed for this account. Kept
  // independently of tierSource so a protected manual/console grant can ignore
  // delayed store events after its window ends.
  revenuecatEventAt: timestamp('revenuecat_event_at', { withTimezone: true }),
  // 'suspended' kills every session for this account at the auth choke point
  // (userForToken filters on status='active'). Defaulted so existing rows and
  // the mobile GET/POST are unaffected.
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  // Public-leaderboard opt-out (privacy law): true = never appears on the
  // public board — not as a row, not as a position, not in buddies' views.
  // Lives here (not account_profiles) beside the other server-authoritative
  // identity flags: account_profiles rows only exist after a profile sync.
  publicBoardHidden: boolean('public_board_hidden').notNull().default(false),
  // ISO-3166 alpha-2 (e.g. 'NP', 'US'). Set from the client's expo-localization
  // region hint at login/me refresh; drives regional pricing default + admin
  // analytics. Nullable — unknown until the client sends a hint.
  country: text('country'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Opaque 64-char hex session tokens, 30-day expiry. */
export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('sessions_account').on(t.accountId), // cascade-delete + per-account session ops
    index('sessions_expires').on(t.expiresAt), // hourly expired-session sweep (lib/auth)
  ],
);

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
  (t) => [
    uniqueIndex('buddy_links_requester_addressee').on(t.requesterId, t.addresseeId),
    // The unique index only serves requester-side lookups; incoming-invite and
    // either-direction queries scan on addressee.
    index('buddy_links_addressee').on(t.addresseeId),
  ],
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
  (t) => [
    uniqueIndex('device_push_tokens_token').on(t.token),
    index('device_push_tokens_account').on(t.accountId), // push fan-out is by account
  ],
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
      // Meal-delivery restaurant operator. Web-only console (`/partner`), one
      // partner account ↔ one meal_partners row (accountId UNIQUE). Minted ONLY
      // via POST /api/admin/partners — never a generic staff grant (excluded
      // from GRANTABLE_ROLES in @gym/shared). Outranks nobody; its capabilities
      // are permission-gated (meals.own/orders.fulfill), not rank-gated.
      'partner',
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

/** One certification line on a coach's public portfolio. */
export interface CoachCertification {
  title: string;
  issuer: string;
  year: number | null;
}

/**
 * Public-facing coach identity + capacity settings + portfolio. The portfolio
 * columns (headline, specialties, certifications, achievements, years) feed
 * the member-facing coach discovery hub — everything here is intentionally
 * publishable; nothing private ever goes in this table.
 */
export const coachProfiles = pgTable('coach_profiles', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull().default(''),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url'),
  // Seniority badge (NOT a money/billing tier — that's accounts.tier). Set to
  // 'silver' on coach-application approval; admin can change anytime, or a
  // coach can request an upgrade via coach_tier_requests.
  coachTier: text('coach_tier', { enum: ['silver', 'gold', 'elite'] })
    .notNull()
    .default('silver'),
  /** One-line pitch under the name ("Hypertrophy coach · 8 yrs"). */
  headline: text('headline').notNull().default(''),
  /** Training specialties from the shared COACH_SPECIALTIES catalog. */
  specialties: jsonb('specialties').$type<string[]>().notNull().default([]),
  certifications: jsonb('certifications').$type<CoachCertification[]>().notNull().default([]),
  /** Free-form achievement lines ("2023 Nationals — 3rd, 93kg"). */
  achievements: jsonb('achievements').$type<string[]>().notNull().default([]),
  yearsExperience: integer('years_experience').notNull().default(0),
  /** Max active clients; requests are refused at/over this. */
  capacity: integer('capacity').notNull().default(50),
  acceptingClients: boolean('accepting_clients').notNull().default(true),
  replyWindowHours: integer('reply_window_hours').notNull().default(24),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Member-initiated coaching requests (the matching flow). One PENDING request
 * per member at a time (enforced in the route — a member shops one coach at a
 * time). Accepting upserts the coachAssignments row and ends the member's
 * other active assignments so "my coach" stays singular.
 */
export const coachRequests = pgTable(
  'coach_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted', 'declined', 'canceled'] })
      .notNull()
      .default('pending'),
    /** Optional intro from the member ("goal: first pull-up"). PII-masked. */
    message: text('message').notNull().default(''),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coach_requests_user_created').on(t.userId, t.createdAt),
    index('coach_requests_coach_status').on(t.coachId, t.status),
  ],
);

/**
 * Coach-logged client milestones — the trainee's coach-built portfolio
 * ("First 100kg squat", "-8kg in 12 weeks"). Written only by the client's own
 * coach; readable by the member as their verified progress story.
 */
export const coachMilestones = pgTable(
  'coach_milestones',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    note: text('note').notNull().default(''),
    /** Local date the milestone was achieved (YYYY-MM-DD). */
    achievedAt: date('achieved_at', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coach_milestones_account_achieved').on(t.accountId, t.achievedAt),
    index('coach_milestones_coach').on(t.coachId),
  ],
);

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
    index('audit_log_created').on(t.createdAt), // console's default recent-first feed
    index('audit_log_action_created').on(t.action, t.createdAt), // action-filtered feed
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
    // Plausibility: false = excluded from leaderboards/badges/quests/challenges/PR credit.
    ranked: boolean('ranked').notNull().default(true),
    flagReason: text('flag_reason'), // 'absolute_bounds' | 'velocity' — null when ranked
  },
  (t) => [
    index('synced_workouts_account_date').on(t.accountId, t.date),
    // Public leaderboard: whole-gym ranked=true scan bounded by a month window.
    index('synced_workouts_ranked_date').on(t.ranked, t.date),
  ],
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
  (t) => [
    index('synced_sets_account_exercise_logged').on(t.accountId, t.exerciseId, t.loggedAt),
    index('synced_sets_workout').on(t.workoutId), // per-workout set fetch + FK cascade
  ],
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

/**
 * Gamification (Phase 1+2) — one cached profile row per account. XP/streak
 * math lives in @gym/shared (logic/gamificationXp.ts, logic/weeklyStreak.ts);
 * this row is a server-side cache recomputed by runAwardEngine on every
 * sync/check-in/GET so reads stay cheap.
 */
export const gamificationProfiles = pgTable('gamification_profiles', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  xpTotal: integer('xp_total').notNull().default(0),
  weeklyTargetDays: integer('weekly_target_days').notNull().default(3), // 2..7
  streakWeeks: integer('streak_weeks').notNull().default(0), // cached, recomputed
  bestStreakWeeks: integer('best_streak_weeks').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Bounded XP ledger (DESIGN LAW 1) — sourceKey makes every award idempotent
 * per (account, kind, sourceKey): a date for daily_workout, a weekStart for
 * streak_week, a checkInId for checkin, a setId for pr, a badgeId for badge,
 * a fresh random id for admin_correction (each correction is its own event —
 * not idempotent against re-application by design, since a staffer may need
 * to apply several corrections to the same account).
 *
 * 'admin_correction' (P2 gamification oversight, admin console) is a plain
 * text column value — Drizzle's `{enum:[...]}` here is TS-only sugar with no
 * Postgres CHECK constraint, so adding this value is a zero-migration,
 * additive change picked up by `pnpm db:push` as a no-op DDL diff.
 */
export const xpEvents = pgTable(
  'xp_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['daily_workout', 'streak_week', 'checkin', 'pr', 'badge', 'admin_correction'],
    }).notNull(),
    sourceKey: text('source_key').notNull(),
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('xp_events_account_kind_source').on(t.accountId, t.kind, t.sourceKey)],
);

/**
 * Earned badges (catalog itself is pure data in @gym/shared). Strength-club
 * badges start 'logged'; only a coach can flip them to 'verified'. badgeId
 * also carries synthetic ids of the form `challenge:<challengeId>` for
 * coach-challenge completions.
 */
export const awardedBadges = pgTable(
  'awarded_badges',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    badgeId: text('badge_id').notNull(), // catalog id, or `challenge:<challengeId>`
    status: text('status', { enum: ['logged', 'verified'] })
      .notNull()
      .default('logged'),
    verifiedBy: text('verified_by').references(() => accounts.id, { onDelete: 'set null' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('awarded_badges_account_badge').on(t.accountId, t.badgeId),
    index('awarded_badges_status').on(t.status, t.earnedAt),
  ],
);

/** Rest Shield consumption — one row per shielded week, quota drawn per calendar month. */
export const restShieldUses = pgTable(
  'rest_shield_uses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(), // Monday yyyy-mm-dd of the shielded week
    monthKey: text('month_key').notNull(), // 'yyyy-mm' the quota is drawn from
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('rest_shield_uses_account_week').on(t.accountId, t.weekStart)],
);

/** Coach-created monthly challenge. ONE active challenge per coach per month. */
export const coachChallenges = pgTable(
  'coach_challenges',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    monthKey: text('month_key').notNull(), // 'yyyy-mm'
    targetDays: integer('target_days').notNull(), // session-days to reach
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('coach_challenges_coach_month').on(t.coachId, t.monthKey)],
);

export const challengeMembers = pgTable(
  'challenge_members',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    challengeId: text('challenge_id')
      .notNull()
      .references(() => coachChallenges.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('challenge_members_challenge_account').on(t.challengeId, t.accountId)],
);

/**
 * Buddy co-op quest completion marker (push idempotency + "already awarded"
 * check). accountA < accountB lexicographically so a pair has exactly one row.
 */
export const buddyQuestAwards = pgTable(
  'buddy_quest_awards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    monthKey: text('month_key').notNull(),
    accountA: text('account_a')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accountB: text('account_b')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('buddy_quest_awards_month_pair').on(t.monthKey, t.accountA, t.accountB)],
);

/** Coach acknowledgement of a flagged (unranked) workout — one row per workout. */
export const workoutFlagAcks = pgTable('workout_flag_acks', {
  workoutId: text('workout_id')
    .primaryKey()
    .references(() => syncedWorkouts.id, { onDelete: 'cascade' }),
  coachId: text('coach_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  ackedAt: timestamp('acked_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Coach's pick — one manually-awarded spotlight member per coach per month. */
export const coachPicks = pgTable(
  'coach_picks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    monthKey: text('month_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('coach_picks_coach_month').on(t.coachId, t.monthKey)],
);

/**
 * Self-serve coach applications (SCALE-UP-PLAN §1.4). Any member may apply
 * once — one non-rejected application per account is route-enforced (same
 * pattern as coach_requests: no partial-unique constraint here). Free-text
 * fields (bio, achievements) are PII-masked before storage. Admin approval
 * upserts coach_profiles from these fields (incl. avatarUrl), grants
 * `admins.role = 'coach'`, and generates the coach's promo code.
 */
export const coachApplications = pgTable(
  'coach_applications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    headline: text('headline').notNull().default(''),
    bio: text('bio').notNull().default(''),
    yearsExperience: integer('years_experience').notNull().default(0),
    specialties: jsonb('specialties').$type<string[]>().notNull().default([]),
    certifications: jsonb('certifications').$type<CoachCertification[]>().notNull().default([]),
    achievements: jsonb('achievements').$type<string[]>().notNull().default([]),
    avatarUrl: text('avatar_url'),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    reviewNote: text('review_note'),
    decidedBy: text('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coach_applications_account_created').on(t.accountId, t.createdAt),
    index('coach_applications_status').on(t.status, t.createdAt),
    // At most ONE pending application per account (C4): closes the check-then-
    // insert race so a stale duplicate can't later clobber a live coach profile.
    // Route uses onConflictDoNothing→409 'already_open'.
    uniqueIndex('coach_applications_one_pending')
      .on(t.accountId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Coach-requested seniority-tier upgrade (silver→gold→elite is a badge, not
 * money — see coach_profiles.coachTier). One PENDING request per coach is
 * route-enforced, same pattern as coach_applications.
 */
export const coachTierRequests = pgTable(
  'coach_tier_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    requestedTier: text('requested_tier', { enum: ['silver', 'gold', 'elite'] }).notNull(),
    note: text('note').notNull().default(''),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    decidedBy: text('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coach_tier_requests_coach_status').on(t.coachId, t.status, t.createdAt),
    // At most ONE pending tier request per coach (C11): closes the duplicate-
    // pending race on the coach POST. Route uses onConflictDoNothing→409.
    uniqueIndex('coach_tier_requests_one_pending')
      .on(t.coachId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Discount codes. Every VERIFIED coach auto-gets one code (ownerCoachId set)
 * at a fixed 30% discount / 30% commission; admins can also mint "house" codes
 * (ownerCoachId null, any discountPct, zero commission). `code` is always
 * stored uppercase (see logic/promo.ts normalizePromoCode/generatePromoCode).
 */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    code: text('code').notNull().unique(),
    // set null (not cascade): codes and their redemption history are financial
    // records that must survive a coach account deletion.
    ownerCoachId: text('owner_coach_id').references(() => accounts.id, { onDelete: 'set null' }),
    discountPct: integer('discount_pct').notNull(),
    commissionPct: integer('commission_pct').notNull().default(0),
    active: boolean('active').notNull().default(true),
    maxRedemptions: integer('max_redemptions'),
    redemptionCount: integer('redemption_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('promo_codes_owner_coach').on(t.ownerCoachId)],
);

/**
 * One redemption per (code, account) — starts 'reserved' at redeem time and
 * flips to 'applied' once a paid grant actually lands and
 * settlePromoOnPurchase runs (purchaseAmountMinor/currency/commissionMinor
 * filled in then; referral-sourced grants never touch this table).
 */
export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    codeId: text('code_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['reserved', 'applied'] })
      .notNull()
      .default('reserved'),
    purchaseAmountMinor: integer('purchase_amount_minor'),
    currency: text('currency'),
    commissionMinor: integer('commission_minor'),
    // Stamped atomically with promo_codes.redemption_count. A retry can repair
    // a missing discount grant without incrementing the cap a second time.
    countedAt: timestamp('counted_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('promo_redemptions_code_account').on(t.codeId, t.accountId)],
);

/**
 * Best-active-discount-wins ledger the pricing catalog reads at fetch time.
 * Only one 'active' grant per account matters — redeeming a new code
 * supersedes older active grants to 'expired' (POST /api/promo/redeem); a
 * purchase consumes the winning grant to 'consumed'. Referral joins insert a
 * pair of these (source 'referral', no promoCodeId) per SCALE-UP-PLAN §1.3.
 */
export const discountGrants = pgTable(
  'discount_grants',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['referral', 'promo'] }).notNull(),
    promoCodeId: text('promo_code_id').references(() => promoCodes.id, { onDelete: 'set null' }),
    pct: integer('pct').notNull(),
    status: text('status', { enum: ['active', 'consumed', 'expired'] })
      .notNull()
      .default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('discount_grants_account_status').on(t.accountId, t.status),
    // At most ONE active grant per account (E6): with zero active grants, two
    // concurrent redemptions would otherwise both insert 'active' (nothing to
    // lock). The redeem path conflict-re-runs against this constraint.
    uniqueIndex('discount_grants_one_active')
      .on(t.accountId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * Append-only per-coach wallet ledger — balance = SUM(amountMinor) per coach
 * per currency (no materialized balance column); amountMinor is negative for
 * payouts. Idempotency for commission credits comes from the plain unique
 * index below: Postgres never treats two NULLs as equal, so manual
 * adjustments/payouts (sourceType/sourceId both null) never collide with each
 * other — only a repeated concrete (sourceType, sourceId) pair does, which is
 * exactly the "settle this redemption once" guarantee settlePromoOnPurchase
 * needs. No WHERE-partial index required.
 */
export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // restrict (not cascade): money history must never vanish with an account
    // row; coaches with ledger entries can only be suspended, not hard-deleted.
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    type: text('type', { enum: ['commission', 'adjustment', 'payout'] }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    sourceType: text('source_type'), // e.g. 'promo_redemption' | 'admin'
    sourceId: text('source_id'),
    note: text('note'),
    createdBy: text('created_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('wallet_ledger_coach_created').on(t.coachId, t.createdAt),
    uniqueIndex('wallet_ledger_source').on(t.sourceType, t.sourceId),
  ],
);

/**
 * Idempotency ledger for the RevenueCat webhook (apps/web .../revenuecat/route.ts).
 * RevenueCat delivers at-least-once (it retries on timeout even after a prior
 * attempt succeeded), so the SAME event.id can arrive twice. The route inserts
 * the event id here before running purchase settlement; onConflictDoNothing
 * makes a redelivery a no-op instead of re-consuming whatever discount grant
 * happens to be active at redelivery time.
 */
export const revenuecatEvents = pgTable('revenuecat_events', {
  eventId: text('event_id').primaryKey(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  type: text('type').notNull().default('legacy'),
  eventAt: timestamp('event_at', { withTimezone: true }).notNull().defaultNow(),
  tierAppliedAt: timestamp('tier_applied_at', { withTimezone: true }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin-editable regional pricing catalog. GET /api/subscription/catalog
 * resolves a region then reads the (region, tier) row here, falling back to
 * DEFAULT_TIER_PRICES in @gym/shared when no row exists yet (pre-seed safe).
 * Amounts are minor units (paisa/cents) — see logic/pricing.ts.
 */
export const tierPrices = pgTable(
  'tier_prices',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    region: text('region', { enum: ['NP', 'INTL'] }).notNull(),
    tier: text('tier', { enum: ['starter', 'silver', 'gold', 'elite'] }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    active: boolean('active').notNull().default(true),
    updatedBy: text('updated_by').references(() => accounts.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tier_prices_region_tier').on(t.region, t.tier)],
);

/**
 * Nepal manual-payment queue (eSewa/Khalti/bank) — the only paid path for NP
 * until store billing exists (works in both preview and live BILLING_MODE).
 * amountMinor is computed server-side from the catalog (with any active
 * discount_grant applied) at submit time — never trusted from the client.
 * Admin approve runs a dated setAccountTier for the window + the promo
 * commission hook; reject just records reviewNote.
 */
export const paymentRequests = pgTable(
  'payment_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tier: text('tier', { enum: ['starter', 'silver', 'gold', 'elite'] }).notNull(),
    months: integer('months').notNull(),
    region: text('region', { enum: ['NP', 'INTL'] }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    method: text('method', { enum: ['esewa', 'khalti', 'bank', 'other'] }).notNull(),
    receiptUrl: text('receipt_url').notNull(),
    note: text('note'),
    promoCodeId: text('promo_code_id').references(() => promoCodes.id, { onDelete: 'set null' }),
    // --- Settlement snapshot (B3): pricing/discount context frozen at SUBMIT so
    // approval settles deterministically regardless of later grant/catalog drift.
    // discountGrantId is the specific grant reserved for THIS request (released
    // on reject, settled on approve); discountPct/baseAmountMinor record the
    // catalog price and applied discount so the approver never re-resolves LIVE
    // state. All nullable — a request with no promo leaves them null.
    discountGrantId: text('discount_grant_id').references(() => discountGrants.id, {
      onDelete: 'set null',
    }),
    discountPct: integer('discount_pct'),
    baseAmountMinor: integer('base_amount_minor'),
    // --- Idempotent approval (B2): stamped once each side effect lands so the
    // decide endpoint can re-run a partially-settled 'approved' row without
    // double-granting or double-crediting. tierGrantedAt = tier window applied;
    // settledAt = wallet/promo settlement done.
    tierGrantedAt: timestamp('tier_granted_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    // --- Pre-approval tier window snapshot (B1/B2 + P0-1). Captured at the
    // instant the request flips pending→approved, from the member's LIVE tier
    // BEFORE the grant mutates it. The approve handler re-derives the grant
    // window from THIS frozen prior (never the live account a partial-failure
    // retry already mutated), so a re-run reproduces the identical window
    // instead of EXTENDing on top of the tier it already granted; the refund
    // route restores this exact window instead of collapsing a separately-paid
    // tier to starter. Both nullable — legacy rows and no-op grants leave null.
    priorTier: text('prior_tier', { enum: ['starter', 'silver', 'gold', 'elite'] }),
    priorExpiresAt: timestamp('prior_expires_at', { withTimezone: true }),
    priorTierSource: text('prior_tier_source', {
      enum: ['console', 'manual_payment', 'revenuecat', 'preview', 'coach'],
    }),
    priorTierSourceId: text('prior_tier_source_id'),
    // 'refunded' (P0-1): approved→refunded rolls the tier back + posts a negative
    // wallet adjustment + reverses the promo redemption (see refund route).
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'refunded'] })
      .notNull()
      .default('pending'),
    reviewNote: text('review_note'),
    decidedBy: text('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payment_requests_status_created').on(t.status, t.createdAt),
    uniqueIndex('payment_requests_receipt').on(t.receiptUrl),
    uniqueIndex('payment_requests_one_pending_account')
      .on(t.accountId)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('payment_requests_one_pending_grant')
      .on(t.discountGrantId)
      .where(sql`${t.status} = 'pending' and ${t.discountGrantId} is not null`),
  ],
);

/**
 * One exercise line in a coach-assigned workout. exerciseId is optional —
 * custom entries have no local-library match, matching the synced_sets
 * pattern of not FK'ing the unseeded server `exercises` table.
 */
export interface CoachAssignedWorkoutItem {
  exerciseId: string | null;
  name: string;
  sets: number;
  repRange: string;
  restSec: number;
  note?: string;
  imageUrl?: string;
}

/**
 * Coach-assigned exercise program for one client (SCALE-UP-PLAN §1.2 —
 * `coach_workouts` entitlement, silver+, AND an active coach assignment
 * checked separately in the route, not via tier). `items` is the ordered
 * exercise list rendered on the client's Train tab.
 */
export const coachAssignedWorkouts = pgTable(
  'coach_assigned_workouts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    position: integer('position').notNull().default(0),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    items: jsonb('items').$type<CoachAssignedWorkoutItem[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coach_assigned_workouts_client_status').on(t.clientId, t.status),
    index('coach_assigned_workouts_coach_client').on(t.coachId, t.clientId),
  ],
);

/** One food line item within a meal of a coach-assigned diet plan. */
export interface CoachDietPlanItem {
  name: string;
  qty: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  note?: string;
}

/** One meal (breakfast/lunch/dinner/snacks) in a coach-assigned diet plan. */
export interface CoachDietPlanMeal {
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
  items: CoachDietPlanItem[];
}

/**
 * Coach-assigned diet plan for one client (SCALE-UP-PLAN §1.2 — `coach_diet`
 * entitlement, gold+, AND an active coach assignment checked separately in
 * the route). Same shape/index conventions as coach_assigned_workouts.
 */
export const coachDietPlans = pgTable(
  'coach_diet_plans',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    meals: jsonb('meals').$type<CoachDietPlanMeal[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coach_diet_plans_client_status').on(t.clientId, t.status),
    index('coach_diet_plans_coach_client').on(t.coachId, t.clientId),
  ],
);

/**
 * Friend-to-friend DMs on an accepted buddy_links pair. No PII masking here
 * (mutually-accepted contacts, per SCALE-UP-PLAN §6.4) — body is
 * trimmed/length-bounded at the route boundary instead. `readAt` null = still
 * unread by the recipient.
 */
export const buddyMessages = pgTable(
  'buddy_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    linkId: text('link_id')
      .notNull()
      .references(() => buddyLinks.id, { onDelete: 'cascade' }),
    senderAccountId: text('sender_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('buddy_messages_link_created').on(t.linkId, t.createdAt)],
);

/**
 * Short-lived ownership records for direct provider image uploads. Private
 * assets can only be attached by atomically consuming the account-bound row.
 */
export const imageUploadReservations = pgTable(
  'image_upload_reservations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'progress_photo',
        'payment_receipt',
        'application_avatar',
        'coach_avatar',
        'custom_exercise',
        'diet_item',
        'meal_photo',
        'meal_receipt',
        'gym_photo',
      ],
    }).notNull(),
    assetUid: text('asset_uid').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('image_upload_reservations_asset_uid').on(t.assetUid),
    index('image_upload_reservations_account_kind_expiry').on(
      t.accountId,
      t.kind,
      t.expiresAt,
    ),
    index('image_upload_reservations_expiry').on(t.expiresAt),
  ],
);

/**
 * Member-captured progress photos (silver+ entitlement). `imageUrl` is an
 * authenticated-delivery provider UID, signed freshly for each API response.
 */
export const progressPhotos = pgTable(
  'progress_photos',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    takenOn: date('taken_on', { mode: 'string' }).notNull(),
    imageUrl: text('image_url').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('progress_photos_account_taken').on(t.accountId, t.takenOn),
    uniqueIndex('progress_photos_image_uid').on(t.imageUrl),
  ],
);

/**
 * Support-thread lifecycle (P1-11). Support threads themselves are IMPLICIT —
 * they are the group of `coach_messages` rows with kind='support' for an
 * account (there is no threads table). This side-car row carries the mutable
 * lifecycle state per account so admins can resolve and assign a thread without
 * touching the append-only message history. A row is created lazily on the
 * first assign/resolve; absence means an implicitly-'open' thread. `unread`
 * stays the work signal, but a 'resolved' thread leaves the active queue.
 */
export const supportThreadStates = pgTable(
  'support_thread_states',
  {
    // PK = the account whose support thread this is (one thread per account).
    accountId: text('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'resolved'] })
      .notNull()
      .default('open'),
    // The staff account this thread is currently assigned to (null = unassigned).
    // set null (not cascade) so removing a staff member leaves the thread intact
    // and merely unassigned.
    assignedTo: text('assigned_to').references(() => accounts.id, { onDelete: 'set null' }),
    resolvedBy: text('resolved_by').references(() => accounts.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Inbox filters: open vs resolved, most-recently-touched first.
    index('support_thread_states_status_updated').on(t.status, t.updatedAt),
    // "Threads assigned to me" view.
    index('support_thread_states_assigned').on(t.assignedTo),
  ],
);

/**
 * Coach-initiated payout requests (P1-12). A coach requests a withdrawal of
 * their wallet balance (in a single currency, over a minimum threshold checked
 * in the route); an admin approves → mark 'paid' after recording the actual
 * disbursement, which posts a negative `wallet_ledger` payout entry with the
 * same `disbursementRef`. The request itself is a workflow record (cascades
 * with the coach); the money movement lives in the append-only wallet_ledger.
 * One PENDING request per coach is enforced by the partial unique index.
 */
export const coachPayoutRequests = pgTable(
  'coach_payout_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    currency: text('currency').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'paid'] })
      .notNull()
      .default('pending'),
    note: text('note'),
    // Bank/eSewa/Khalti transaction reference recorded when the payout is
    // actually disbursed — links the request to its wallet_ledger payout row.
    disbursementRef: text('disbursement_ref'),
    decidedBy: text('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('coach_payout_requests_coach_status').on(t.coachId, t.status),
    // Admin queue: pending-first, oldest-first.
    index('coach_payout_requests_status_requested').on(t.status, t.requestedAt),
    // At most ONE pending payout request per coach.
    uniqueIndex('coach_payout_requests_one_pending')
      .on(t.coachId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Per-account permission overrides (P2-20). Layered on top of the role preset
 * inside `requirePermission` (apps/web/src/lib/authz.ts): allow=true GRANTS an
 * extra permission to the account, allow=false STRIPS a preset permission.
 * super_admin is a safety floor — overrides never apply to it. Composite PK
 * (accountId, perm) so each perm has at most one override per account (upserted).
 * `perm` is free text (a Permission key from @gym/shared) rather than an enum so
 * new permission keys never require a schema migration.
 */
export const adminPermissionOverrides = pgTable(
  'admin_permission_overrides',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    perm: text('perm').notNull(), // a Permission key (@gym/shared)
    allow: boolean('allow').notNull(), // true = grant extra, false = strip preset
    grantedBy: text('granted_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.perm] }),
    // requirePermission fetches all overrides for one account per request.
    index('admin_permission_overrides_account').on(t.accountId),
  ],
);

/**
 * Admin-initiated password reset tokens (P1-7). No admin password capability
 * existed before; this lets a `members.manage_credentials` holder mint a
 * single-use, time-boxed reset token. Only the SHA-256 hash of the token is
 * stored (the plaintext is handed to the member out of band); `usedAt` marks
 * consumption so a token is redeemable once. `createdBy` is the staff actor
 * (null for any future self-serve path).
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(), // SHA-256 of the reset token
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Redemption looks the token up by its hash (constant-time equality upstream).
    uniqueIndex('password_reset_tokens_hash').on(t.tokenHash),
    // "Outstanding tokens for this account" + cascade support.
    index('password_reset_tokens_account').on(t.accountId),
  ],
);

// ===========================================================================
// MEAL DELIVERY + NEARBY GYMS (2026-07-18 marketplace wave — plan §1.2/§4).
// Additive-only. Money in integer minor units (paisa/cents). Neon-http has NO
// transactions → all daily-order creation flows through a single CAS
// (onConflictDoNothing on the partial unique index); status advances are
// version-guarded UPDATEs. Asia/Kathmandu = fixed UTC+05:45 (pure logic in
// @gym/shared, no tz dependency). Cutoff/price/macros/delivery snapshots are
// FROZEN at row creation and never re-resolved.
// ===========================================================================

/**
 * A meal-delivery restaurant/partner. Login identity is `accountId` (UNIQUE —
 * exactly one partner row per account), which also carries the `partner`
 * admins.role row. Every partner-scoped query is filtered by the partnerId
 * derived from the auth guard (never the request body). Deactivation flips
 * `isActive=false` AND deletes the account's sessions (two kill-switches).
 */
export const mealPartners = pgTable(
  'meal_partners',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contact: text('contact').notNull().default(''),
    phone: text('phone').notNull().default(''),
    addressText: text('address_text').notNull().default(''),
    // Delivery zones this partner serves (free-text area names, matched against
    // a member's saved-address area).
    serviceAreas: text('service_areas').array().notNull().default(sql`'{}'::text[]`),
    // Geo service origin + reach (additive 2026-07-18 geo wave). serviceLat/Lng
    // is the kitchen/dispatch point; serviceRadiusKm is the delivery reach used
    // by withinRadiusKm to decide whether a member's saved-address point is in
    // range (a geo complement to the free-text serviceAreas match). All nullable
    // so existing rows and db:push stay safe; radius null = distance-gating off.
    serviceLat: doublePrecision('service_lat'),
    serviceLng: doublePrecision('service_lng'),
    serviceRadiusKm: doublePrecision('service_radius_km'),
    acceptsCod: boolean('accepts_cod').notNull().default(true),
    timezone: text('timezone').notNull().default('Asia/Kathmandu'),
    currency: text('currency').notNull().default('NPR'),
    isActive: boolean('is_active').notNull().default(true),
    // Operational pause independent of admin deactivation and menu stock.
    acceptingOrders: boolean('accepting_orders').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meal_partners_account').on(t.accountId),
    index('meal_partners_active').on(t.isActive),
  ],
);

/**
 * A menu item owned by one partner. `isDeleted` is a soft-delete so historical
 * order item snapshots keep resolving. Macros are integers; price is minor
 * units in the row's own `currency`. All partner CRUD is scoped by partnerId.
 */
export const meals = pgTable(
  'meals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    partnerId: text('partner_id')
      .notNull()
      .references(() => mealPartners.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    imageUrl: text('image_url'), // Cloudinary public id / delivery url (nullable)
    kcal: integer('kcal').notNull(),
    proteinG: integer('protein_g').notNull(),
    carbsG: integer('carbs_g').notNull(),
    fatG: integer('fat_g').notNull(),
    fiberG: integer('fiber_g'),
    sugarG: integer('sugar_g'),
    dietType: text('diet_type', { enum: ['veg', 'non_veg', 'egg'] }).notNull(),
    // ⊆ {cutting,bulking,balanced} — drives the member goal filter.
    goalTags: text('goal_tags').array().notNull().default(sql`'{}'::text[]`),
    priceMinor: integer('price_minor').notNull(),
    currency: text('currency', { enum: ['NPR', 'USD'] }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isDeleted: boolean('is_deleted').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meals_partner').on(t.partnerId),
    index('meals_partner_active').on(t.partnerId, t.isActive),
  ],
);

/**
 * When a meal is orderable: (dayOfWeek 0-6, 0=Sun KTM) × window. A meal with no
 * availability rows is treated as always-available (partner opt-in narrowing).
 */
export const mealAvailability = pgTable(
  'meal_availability',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(), // 0=Sun … 6=Sat (KTM)
    window: text('window', { enum: ['lunch', 'dinner'] }).notNull(),
  },
  (t) => [uniqueIndex('meal_availability_meal_day_window').on(t.mealId, t.dayOfWeek, t.window)],
);

/**
 * A member's saved delivery address. `isDeleted` soft-delete keeps prior orders'
 * FK (meal_orders.addressId onDelete set null) intact for real deletes.
 */
export const savedAddresses = pgTable(
  'saved_addresses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default(''),
    line: text('line').notNull(),
    area: text('area').notNull().default(''),
    phone: text('phone').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    isDefault: boolean('is_default').notNull().default(false),
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saved_addresses_account').on(t.accountId)],
);

/**
 * Weekly billing cycle for a subscription (prepaid, Sun-Sat KTM week). At close
 * (detected on read when now ≥ the week's cutoff) the cycle freezes
 * `amountMinor = plannedSlots × pricePerDayMinor`, flips open→awaiting_payment
 * and mints a meal_payment_requests row. Referenced by meal_orders/…_requests,
 * declared before them so the FK targets resolve.
 */
export const mealBillingCycles = pgTable(
  'meal_billing_cycles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => mealSubscriptions.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(), // Sunday (KTM)
    weekEnd: date('week_end').notNull(), // Saturday (KTM)
    plannedSlots: integer('planned_slots').notNull().default(0),
    pricePerDayMinor: integer('price_per_day_minor').notNull(),
    currency: text('currency').notNull(),
    amountMinor: integer('amount_minor').notNull().default(0), // frozen at close
    status: text('status', { enum: ['open', 'awaiting_payment', 'paid', 'void'] })
      .notNull()
      .default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meal_billing_cycles_sub_week').on(t.subscriptionId, t.weekStart),
    index('meal_billing_cycles_account').on(t.accountId),
    index('meal_billing_cycles_status').on(t.status),
  ],
);

/**
 * A recurring meal subscription. Materialization (on-read, horizon =
 * today+tomorrow KTM) spawns meal_orders from ACTIVE subs. `mealId` set for
 * fixed_meal plans; partner_rotating resolves deterministically per date.
 * `pricePerDayMinor` is a snapshot (delivery folded in — no per-order fee).
 */
export const mealSubscriptions = pgTable(
  'meal_subscriptions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    partnerId: text('partner_id')
      .notNull()
      .references(() => mealPartners.id, { onDelete: 'cascade' }),
    daysOfWeek: integer('days_of_week').array().notNull().default(sql`'{}'::integer[]`),
    window: text('window', { enum: ['lunch', 'dinner'] }).notNull(),
    planType: text('plan_type', { enum: ['fixed_meal', 'partner_rotating'] }).notNull(),
    mealId: text('meal_id').references(() => meals.id, { onDelete: 'set null' }),
    addressId: text('address_id')
      .notNull()
      .references(() => savedAddresses.id, { onDelete: 'restrict' }),
    pricePerDayMinor: integer('price_per_day_minor').notNull(),
    currency: text('currency', { enum: ['NPR', 'USD'] }).notNull(),
    paymentMethod: text('payment_method', { enum: ['esewa', 'khalti', 'cod'] }).notNull(),
    startDate: date('start_date').notNull(),
    status: text('status', { enum: ['active', 'paused', 'cancelled'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meal_subscriptions_account').on(t.accountId),
    index('meal_subscriptions_partner_status').on(t.partnerId, t.status),
  ],
);

/**
 * A member's skip of one delivery date for a subscription. Insert suppresses
 * materialization before the row exists (guarded now<cutoff); if already
 * materialized, the skip route additionally CAS-cancels the pending order.
 */
export const mealSubSkips = pgTable(
  'meal_sub_skips',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => mealSubscriptions.id, { onDelete: 'cascade' }),
    deliveryDate: date('delivery_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('meal_sub_skips_sub_date').on(t.subscriptionId, t.deliveryDate)],
);

/**
 * A single meal order (one_time or a materialized subscription slot). The
 * member's `accountId` is SERVER-ONLY and MUST NOT be serialized into any
 * partner projection. Delivery snapshot fields + fees + `cutoffAt` are frozen
 * at creation. `statusVersion` backs the CAS advance. The partial unique index
 * on (subscriptionId,deliveryDate,window) WHERE source='subscription' is the
 * materialization idempotency key — racing materializers no-op via
 * onConflictDoNothing.
 */
export const mealOrders = pgTable(
  'meal_orders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    partnerId: text('partner_id')
      .notNull()
      .references(() => mealPartners.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['one_time', 'subscription'] }).notNull(),
    subscriptionId: text('subscription_id').references(() => mealSubscriptions.id, {
      onDelete: 'set null',
    }),
    cycleId: text('cycle_id').references(() => mealBillingCycles.id, { onDelete: 'set null' }),
    // Nullable for subscription + legacy rows. New one-time checkouts always
    // set both fields; the partial index below scopes request ids per account.
    clientRequestId: text('client_request_id'),
    requestFingerprint: text('request_fingerprint'),
    deliveryDate: date('delivery_date').notNull(),
    window: text('window', { enum: ['lunch', 'dinner'] }).notNull(),
    addressId: text('address_id').references(() => savedAddresses.id, { onDelete: 'set null' }),
    // Delivery snapshot (frozen; free-text notes maskPii'd before store).
    deliveryName: text('delivery_name').notNull(),
    deliveryPhone: text('delivery_phone').notNull(),
    deliveryAddressText: text('delivery_address_text').notNull(),
    // Geocoded delivery point, frozen at order create from the chosen saved
    // address (nullable: the address was never pinned). A later edit to the
    // address must never move a past order's pin — this is a snapshot, and reads
    // fall back to the live saved_addresses coords only when it is null.
    deliveryLat: doublePrecision('delivery_lat'),
    deliveryLng: doublePrecision('delivery_lng'),
    deliveryNotes: text('delivery_notes').notNull().default(''),
    subtotalMinor: integer('subtotal_minor').notNull(),
    deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
    smallOrderFeeMinor: integer('small_order_fee_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    currency: text('currency', { enum: ['NPR', 'USD'] }).notNull(),
    paymentMethod: text('payment_method', { enum: ['esewa', 'khalti', 'cod'] }).notNull(),
    paymentStatus: text('payment_status', {
      enum: ['unpaid', 'receipt_submitted', 'paid', 'refunded'],
    })
      .notNull()
      .default('unpaid'),
    status: text('status', {
      enum: [
        'pending',
        'confirmed',
        'preparing',
        'out_for_delivery',
        'delivered',
        'cancelled',
        'refused',
      ],
    })
      .notNull()
      .default('pending'),
    statusVersion: integer('status_version').notNull().default(0),
    cutoffAt: timestamp('cutoff_at', { withTimezone: true }).notNull(), // frozen at create
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    decidedBy: text('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Materialization CAS key — one subscription slot per (sub,date,window).
    uniqueIndex('meal_orders_sub_slot')
      .on(t.subscriptionId, t.deliveryDate, t.window)
      .where(sql`${t.source} = 'subscription'`),
    uniqueIndex('meal_orders_account_client_request')
      .on(t.accountId, t.clientRequestId)
      .where(sql`${t.source} = 'one_time' AND ${t.clientRequestId} IS NOT NULL`),
    index('meal_orders_partner_status').on(t.partnerId, t.status),
    index('meal_orders_account').on(t.accountId),
    index('meal_orders_partner_date').on(t.partnerId, t.deliveryDate),
  ],
);

/** Line items of an order, with name/price/macros snapshotted at creation. */
export const mealOrderItems = pgTable(
  'meal_order_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orderId: text('order_id')
      .notNull()
      .references(() => mealOrders.id, { onDelete: 'cascade' }),
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'restrict' }),
    nameSnapshot: text('name_snapshot').notNull(),
    priceMinorSnapshot: integer('price_minor_snapshot').notNull(),
    macrosSnapshot: jsonb('macros_snapshot').$type<MealMacrosSnapshot>().notNull(),
    qty: integer('qty').notNull(),
  },
  (t) => [index('meal_order_items_order').on(t.orderId)],
);

/** Append-only status-transition audit for an order. */
export const mealOrderEvents = pgTable(
  'meal_order_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orderId: text('order_id')
      .notNull()
      .references(() => mealOrders.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorId: text('actor_id').references(() => accounts.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('meal_order_events_order').on(t.orderId)],
);

/**
 * Manual receipt-based payment request for meals — a sibling of
 * `paymentRequests`, scoped to an order OR a billing cycle (exactly one set).
 * eSewa/Khalti only (COD reconciles on delivery). `receiptUrl` UNIQUE dedupes
 * a resubmitted screenshot. Admin approve → paid; refund is idempotent-stamped.
 */
export const mealPaymentRequests = pgTable(
  'meal_payment_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    orderId: text('order_id').references(() => mealOrders.id, { onDelete: 'cascade' }),
    cycleId: text('cycle_id').references(() => mealBillingCycles.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    method: text('method', { enum: ['esewa', 'khalti'] }).notNull(),
    receiptUrl: text('receipt_url').notNull().unique(),
    note: text('note'),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'refunded'] })
      .notNull()
      .default('pending'),
    reviewNote: text('review_note'),
    decidedBy: text('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meal_payment_requests_account').on(t.accountId),
    index('meal_payment_requests_status').on(t.status),
  ],
);

/**
 * Singleton config row (id='singleton') holding server-authoritative fee +
 * cutoff parameters. The client never sets fees/price/cutoff. Defaults mirror
 * the frozen constants in @gym/shared (cutoffFor uses 21:00 prev-day lunch /
 * 10:00 same-day dinner).
 */
export const mealDeliveryConfig = pgTable('meal_delivery_config', {
  id: text('id').primaryKey().default('singleton'),
  smallOrderFeeMinor: integer('small_order_fee_minor').notNull().default(5000), // Rs50
  smallOrderThresholdMinor: integer('small_order_threshold_minor').notNull().default(50000), // Rs500
  deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(5000), // Rs50 flat
  freeDeliveryThresholdMinor: integer('free_delivery_threshold_minor').notNull().default(100000), // Rs1000
  lunchCutoffPrevDayHour: integer('lunch_cutoff_prev_day_hour').notNull().default(21),
  dinnerCutoffSameDayHour: integer('dinner_cutoff_same_day_hour').notNull().default(10),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/** Macros snapshot embedded in a meal_order_items row (frozen at order time). */
export interface MealMacrosSnapshot {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
}

/** A social profile link on a gym listing. */
export interface GymSocialLink {
  platform: string;
  url: string;
}

/** One open→close shift on a gym's weekly hours (HH:MM 24h, KTM local). */
export interface GymHoursShift {
  open: string;
  close: string;
}

/** Structured weekly hours: per-weekday-key list of shifts (empty = closed). */
export type GymWeeklyHours = Partial<Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', GymHoursShift[]>>;

/**
 * A discoverable nearby gym/studio. Admin-CRUD only. Publish gated behind
 * `verifiedByAdmin` + status='published'. `externalImageUrl` is operator-
 * supplied ("not verified by us"); listing photos live in gym_photos and are
 * admin-uploaded via Cloudinary (NEVER scraped/hotlinked). `rating`/
 * `reviewCount` are our OWN reviews only (null until that surface ships).
 */
export const gyms = pgTable(
  'gyms',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    category: text('category', {
      enum: ['gym', 'health_club', 'studio', 'crossfit', 'yoga', 'other'],
    })
      .notNull()
      .default('gym'),
    addressText: text('address_text').notNull().default(''),
    city: text('city').notNull().default(''),
    district: text('district').notNull().default(''),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    phone: text('phone').notNull().default(''),
    website: text('website'),
    socialLinks: jsonb('social_links').$type<GymSocialLink[]>().notNull().default([]),
    hours: jsonb('hours').$type<GymWeeklyHours>().notNull().default({}),
    amenities: text('amenities').array().notNull().default(sql`'{}'::text[]`),
    externalImageUrl: text('external_image_url'), // operator-supplied, "not verified"
    priceNote: text('price_note').notNull().default(''),
    description: text('description').notNull().default(''),
    rating: doublePrecision('rating'), // OWN reviews only; null until built
    reviewCount: integer('review_count'),
    status: text('status', { enum: ['draft', 'published', 'archived'] })
      .notNull()
      .default('draft'),
    verifiedByAdmin: boolean('verified_by_admin').notNull().default(false),
    createdBy: text('created_by').references(() => accounts.id, { onDelete: 'set null' }),
    lastEditedBy: text('last_edited_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gyms_status').on(t.status), index('gyms_city').on(t.city)],
);

/** Admin-uploaded listing photos for a gym (Cloudinary; reorderable). */
export const gymPhotos = pgTable(
  'gym_photos',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gymId: text('gym_id')
      .notNull()
      .references(() => gyms.id, { onDelete: 'cascade' }),
    uid: text('uid').notNull(), // Cloudinary public id
    deliveryUrl: text('delivery_url').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gym_photos_gym').on(t.gymId)],
);
