import { mealAvailability, mealPartners, meals } from '@gym/db';
import { isMealAvailableForDate, type MealAvailabilitySlot } from '@gym/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member menu browse (§8). Lists a partner's orderable meals, optionally
 * narrowed by goal tag, diet type, and a specific delivery slot's availability.
 * Only ACTIVE, non-deleted meals of an ACTIVE partner are ever returned.
 */

const querySchema = z.object({
  partnerId: z.string().min(1),
  goal: z.enum(['cutting', 'bulking', 'balanced']).optional(),
  diet: z.enum(['veg', 'non_veg', 'egg']).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  window: z.enum(['lunch', 'dinner']).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    partnerId: url.searchParams.get('partnerId') ?? undefined,
    goal: url.searchParams.get('goal') ?? undefined,
    diet: url.searchParams.get('diet') ?? undefined,
    date: url.searchParams.get('date') ?? undefined,
    window: url.searchParams.get('window') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { partnerId, goal, diet, date, window } = parsed.data;

  const db = getDb();

  const [partner] = await db
    .select({ id: mealPartners.id })
    .from(mealPartners)
    .where(and(eq(mealPartners.id, partnerId), eq(mealPartners.isActive, true)))
    .limit(1);
  if (!partner) return json({ meals: [] }, 200);

  const predicates = [
    eq(meals.partnerId, partnerId),
    eq(meals.isActive, true),
    eq(meals.isDeleted, false),
  ];
  if (diet) predicates.push(eq(meals.dietType, diet));

  const rows = await db
    .select({
      id: meals.id,
      name: meals.name,
      description: meals.description,
      imageUrl: meals.imageUrl,
      kcal: meals.kcal,
      proteinG: meals.proteinG,
      carbsG: meals.carbsG,
      fatG: meals.fatG,
      fiberG: meals.fiberG,
      sugarG: meals.sugarG,
      dietType: meals.dietType,
      goalTags: meals.goalTags,
      priceMinor: meals.priceMinor,
      currency: meals.currency,
    })
    .from(meals)
    .where(and(...predicates))
    .orderBy(asc(meals.sortOrder), asc(meals.name));

  // Goal filter is over the array column — done in-process on the (small) menu.
  let result = goal ? rows.filter((m) => m.goalTags.includes(goal)) : rows;

  // Availability filter: keep only meals orderable for the requested delivery
  // slot. A meal with no availability rows is always-available (partner opt-in).
  if (date && window && result.length > 0) {
    const ids = result.map((m) => m.id);
    const availRows = await db
      .select({ mealId: mealAvailability.mealId, dayOfWeek: mealAvailability.dayOfWeek, window: mealAvailability.window })
      .from(mealAvailability)
      .where(inArray(mealAvailability.mealId, ids));
    const byMeal = new Map<string, MealAvailabilitySlot[]>();
    for (const a of availRows) {
      const list = byMeal.get(a.mealId) ?? [];
      list.push({ dayOfWeek: a.dayOfWeek, window: a.window });
      byMeal.set(a.mealId, list);
    }
    result = result.filter((m) => isMealAvailableForDate(byMeal.get(m.id) ?? [], date, window));
  }

  return json({ meals: result }, 200);
}
