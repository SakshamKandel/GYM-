import { accountProfiles, memberFoodLogs, memberWaterLogs } from '@gym/db';
import {
  coachClientNutritionResponseSchema,
  coachClientReadWindow,
  COACH_CLIENT_READ_MAX_DAY_ROWS,
  maskPii,
  type CoachClientFoodEntry,
  type CoachClientNutritionDay,
  type CoachClientNutritionTargets,
} from '@gym/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — a client's nutrition adherence, read-only.
 *
 * Source of truth: the member's OWN logs, replicated device→Neon by
 * `POST /api/sync/member-data` into `member_food_logs` + `member_water_logs`
 * (deterministic LWW, tombstoned deletes — so `deleted=false` is required or a
 * removed meal would keep counting against the member). Daily targets come from
 * the cloud profile blob (`account_profiles.data.targets`), which is
 * client-owned and therefore zod-validated before use; anything missing reads
 * back as null instead of a guessed number.
 *
 * `?days=` (default 30, clamped 1..90) bounds the window, so the query can
 * never widen into an unbounded scan of a long-lived account.
 *
 * PRIVACY: `foodName` is member free text on a member→coach read path, so every
 * name goes through `maskPii` before it leaves the server — the same rule the
 * coach threads and milestones follow.
 *
 * Guards (fail closed): requirePermission('coach.user.read') +
 * requireCoachOwnsUser(userId) → 403 without an ACTIVE assignment (super_admin/
 * main_admin pass without one). The partner role holds neither permission.
 */

/**
 * Hard row ceiling for the food query. 90 days of heavy logging stays well
 * under this; the cap exists so one pathological account cannot pull an
 * unbounded page into memory.
 */
const FOOD_ROW_LIMIT = 5_000;

/**
 * The member's targets inside the client-owned profile blob. Partial + loose:
 * an older or hand-edited blob simply yields nulls rather than a 500.
 */
const storedProfileSchema = z
  .object({
    targets: z
      .object({
        kcal: z.number().finite().min(0).max(100_000),
        protein: z.number().finite().min(0).max(10_000),
        carbs: z.number().finite().min(0).max(10_000),
        fat: z.number().finite().min(0).max(10_000),
        waterMl: z.number().finite().min(0).max(100_000),
      })
      .partial(),
  })
  .partial();

function readTargets(data: unknown): CoachClientNutritionTargets | null {
  const parsed = storedProfileSchema.safeParse(data);
  const targets = parsed.success ? parsed.data.targets : undefined;
  if (!targets) return null;
  const out: CoachClientNutritionTargets = {
    kcal: targets.kcal ?? null,
    protein: targets.protein ?? null,
    carbs: targets.carbs ?? null,
    fat: targets.fat ?? null,
    waterMl: targets.waterMl ?? null,
  };
  const hasAny = Object.values(out).some((v) => v !== null);
  return hasAny ? out : null;
}

/** Totals are sums of floats; round so the console never shows 1874.0000001. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  // `rangeDays` calendar days including today, bounded at both ends against the
  // ISO date strings the device writes (see coachClientReadWindow).
  const { rangeDays, since, until } = coachClientReadWindow(
    new URL(req.url).searchParams.get('days'),
  );

  const db = getDb();

  const [foodRows, waterRows, profileRows] = await Promise.all([
    db
      .select({
        id: memberFoodLogs.id,
        date: memberFoodLogs.date,
        meal: memberFoodLogs.meal,
        foodName: memberFoodLogs.foodName,
        grams: memberFoodLogs.grams,
        kcal: memberFoodLogs.kcal,
        protein: memberFoodLogs.protein,
        carbs: memberFoodLogs.carbs,
        fat: memberFoodLogs.fat,
      })
      .from(memberFoodLogs)
      .where(
        and(
          eq(memberFoodLogs.accountId, userId),
          eq(memberFoodLogs.deleted, false),
          gte(memberFoodLogs.date, since),
          lte(memberFoodLogs.date, until),
        ),
      )
      .orderBy(asc(memberFoodLogs.date))
      .limit(FOOD_ROW_LIMIT),
    db
      .select({ date: memberWaterLogs.date, ml: memberWaterLogs.ml })
      .from(memberWaterLogs)
      .where(
        and(
          eq(memberWaterLogs.accountId, userId),
          eq(memberWaterLogs.deleted, false),
          gte(memberWaterLogs.date, since),
          lte(memberWaterLogs.date, until),
        ),
      )
      .orderBy(asc(memberWaterLogs.date))
      // One row per date by primary key, so the window itself is the ceiling.
      .limit(COACH_CLIENT_READ_MAX_DAY_ROWS),
    db
      .select({ data: accountProfiles.data })
      .from(accountProfiles)
      .where(eq(accountProfiles.accountId, userId))
      .limit(1),
  ]);

  // Roll up per day. One row per date; a day with only water still appears, so
  // the coach can see hydration logged on a day with no food entries.
  const byDate = new Map<string, CoachClientNutritionDay>();
  const dayFor = (date: string): CoachClientNutritionDay => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const created: CoachClientNutritionDay = {
      date,
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      waterMl: 0,
      entries: [],
    };
    byDate.set(date, created);
    return created;
  };

  for (const row of foodRows) {
    const day = dayFor(row.date);
    const entry: CoachClientFoodEntry = {
      id: row.id,
      meal: row.meal,
      // Member free text — masked before it reaches the coach.
      foodName: maskPii(row.foodName),
      grams: row.grams,
      kcal: row.kcal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
    };
    day.entries.push(entry);
    day.kcal += row.kcal;
    day.protein += row.protein;
    day.carbs += row.carbs;
    day.fat += row.fat;
  }

  for (const row of waterRows) {
    dayFor(row.date).waterMl += row.ml;
  }

  const days = [...byDate.values()]
    .map((day) => ({
      ...day,
      kcal: round1(day.kcal),
      protein: round1(day.protein),
      carbs: round1(day.carbs),
      fat: round1(day.fat),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const body = coachClientNutritionResponseSchema.parse({
    synced: foodRows.length > 0 || waterRows.length > 0,
    days,
    rangeDays,
    since,
    targets: readTargets(profileRows[0]?.data),
  });

  return json(body, 200);
}
