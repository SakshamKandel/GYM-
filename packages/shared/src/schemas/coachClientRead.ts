import { z } from 'zod';

/**
 * Response contracts for the coach console's client READ routes
 * (`/api/coach/clients/[userId]/nutrition` and `.../body`).
 *
 * These read a member's own synced logs (member_food_logs / member_water_logs /
 * member_weight_logs / member_measurements) on a member→coach path, so the
 * payload is validated on the way OUT as well as in: the routes parse their own
 * response through these schemas before returning it. That keeps the shape the
 * coach console renders pinned to one place, and makes a bad rollup (NaN totals,
 * a stray unmasked field) fail loudly on the server instead of silently
 * rendering a wrong number a coach might act on.
 *
 * Every free-text member string here (food names) is already `maskPii`'d by the
 * route before it reaches these schemas.
 */

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nonNegativeSchema = z.number().finite().min(0);

/** Window bounds shared by both routes: `days` back from today, inclusive. */
export const COACH_CLIENT_READ_DEFAULT_DAYS = 30;
export const COACH_CLIENT_READ_MIN_DAYS = 1;
export const COACH_CLIENT_READ_MAX_DAYS = 90;

const rangeDaysSchema = z
  .number()
  .int()
  .min(COACH_CLIENT_READ_MIN_DAYS)
  .max(COACH_CLIENT_READ_MAX_DAYS);

/**
 * Max day rows a window can produce: one per calendar day, PLUS one — a device
 * in a timezone ahead of UTC (Nepal is UTC+05:45) stamps its local date, which
 * can be one day ahead of the server's. The routes bound the query at that
 * upper edge, so the array can never grow past this.
 */
export const COACH_CLIENT_READ_MAX_DAY_ROWS = COACH_CLIENT_READ_MAX_DAYS + 1;

// ── Nutrition ────────────────────────────────────────────────────

export const coachClientMealSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snacks']);

/**
 * One logged food entry. `foodName` is member free text and arrives masked, so
 * its cap is well above the 200-char write-time limit (masking replaces short
 * runs with a longer placeholder and can therefore grow the string).
 */
export const coachClientFoodEntrySchema = z
  .object({
    id: z.string().min(1).max(128),
    meal: coachClientMealSchema,
    foodName: z.string().max(2_000),
    grams: nonNegativeSchema.max(100_000),
    kcal: nonNegativeSchema.max(100_000),
    protein: nonNegativeSchema.max(10_000),
    carbs: nonNegativeSchema.max(10_000),
    fat: nonNegativeSchema.max(10_000),
  })
  .strict();

export const coachClientNutritionDaySchema = z
  .object({
    date: isoDateSchema,
    kcal: nonNegativeSchema,
    protein: nonNegativeSchema,
    carbs: nonNegativeSchema,
    fat: nonNegativeSchema,
    waterMl: z.number().int().min(0),
    entries: z.array(coachClientFoodEntrySchema).max(5_000),
  })
  .strict();

/**
 * The member's own daily targets, read from the cloud profile blob
 * (account_profiles.data.targets). The blob is client-owned and free-form, so
 * anything missing or malformed comes back as null rather than a guess.
 */
export const coachClientNutritionTargetsSchema = z
  .object({
    kcal: nonNegativeSchema.nullable(),
    protein: nonNegativeSchema.nullable(),
    carbs: nonNegativeSchema.nullable(),
    fat: nonNegativeSchema.nullable(),
    waterMl: nonNegativeSchema.nullable(),
  })
  .strict();

export const coachClientNutritionResponseSchema = z
  .object({
    /** True once the member has any synced food or water row in the window. */
    synced: z.boolean(),
    /** Oldest day first. */
    days: z.array(coachClientNutritionDaySchema).max(COACH_CLIENT_READ_MAX_DAY_ROWS),
    rangeDays: rangeDaysSchema,
    since: isoDateSchema,
    targets: coachClientNutritionTargetsSchema.nullable(),
  })
  .strict();

export type CoachClientMeal = z.infer<typeof coachClientMealSchema>;
export type CoachClientFoodEntry = z.infer<typeof coachClientFoodEntrySchema>;
export type CoachClientNutritionDay = z.infer<typeof coachClientNutritionDaySchema>;
export type CoachClientNutritionTargets = z.infer<typeof coachClientNutritionTargetsSchema>;
export type CoachClientNutritionResponse = z.infer<typeof coachClientNutritionResponseSchema>;

// ── Body (weight + measurements) ─────────────────────────────────

export const coachClientWeightPointSchema = z
  .object({
    date: isoDateSchema,
    kg: z.number().finite().min(0).max(1_000),
    /** EWMA-smoothed value (same smoothing the member's own Body tab shows). */
    trendKg: z.number().finite().min(0).max(1_000),
  })
  .strict();

export const coachClientWeightSummarySchema = z
  .object({
    direction: z.enum(['up', 'down', 'flat']),
    deltaKg: z.number().finite(),
    ratePerWeekKg: z.number().finite(),
  })
  .strict();

export const coachClientMeasurementSchema = z
  .object({
    id: z.string().min(1).max(128),
    date: isoDateSchema,
    waistCm: z.number().finite().min(0).max(1_000).nullable(),
    chestCm: z.number().finite().min(0).max(1_000).nullable(),
    armCm: z.number().finite().min(0).max(1_000).nullable(),
    hipCm: z.number().finite().min(0).max(1_000).nullable(),
    thighCm: z.number().finite().min(0).max(1_000).nullable(),
  })
  .strict();

export const coachClientBodyResponseSchema = z
  .object({
    /** True once the member has any synced weight or measurement row. */
    synced: z.boolean(),
    /** Oldest day first, so a sparkline can render straight from the array. */
    points: z.array(coachClientWeightPointSchema).max(COACH_CLIENT_READ_MAX_DAY_ROWS),
    summary: coachClientWeightSummarySchema,
    /** Newest first. */
    measurements: z.array(coachClientMeasurementSchema).max(400),
    rangeDays: rangeDaysSchema,
    since: isoDateSchema,
  })
  .strict();

export type CoachClientWeightPoint = z.infer<typeof coachClientWeightPointSchema>;
export type CoachClientWeightSummary = z.infer<typeof coachClientWeightSummarySchema>;
export type CoachClientMeasurement = z.infer<typeof coachClientMeasurementSchema>;
export type CoachClientBodyResponse = z.infer<typeof coachClientBodyResponseSchema>;

/**
 * Shared `?days=` parsing for both routes — default 30, clamped to 1..90, and
 * never NaN (a junk query string falls back to the default instead of widening
 * the window or producing an unbounded scan).
 */
export function parseCoachClientRangeDays(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return COACH_CLIENT_READ_DEFAULT_DAYS;
  return Math.min(COACH_CLIENT_READ_MAX_DAYS, Math.max(COACH_CLIENT_READ_MIN_DAYS, parsed));
}

export interface CoachClientReadWindow {
  rangeDays: number;
  /** Inclusive ISO lower bound (yyyy-mm-dd, UTC). */
  since: string;
  /**
   * Inclusive ISO upper bound — one day past today so a device whose local
   * date runs ahead of UTC still shows today's log, while a bad clock writing
   * far-future dates cannot inflate the day count past the array cap.
   */
  until: string;
}

/** The date window both coach client-read routes bound their queries with. */
export function coachClientReadWindow(
  raw: string | null,
  now: Date = new Date(),
): CoachClientReadWindow {
  const rangeDays = parseCoachClientRangeDays(raw);
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - (rangeDays - 1));
  const until = new Date(now);
  until.setUTCDate(until.getUTCDate() + 1);
  return {
    rangeDays,
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}
