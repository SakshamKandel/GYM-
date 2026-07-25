import { mealAvailability, mealPartners, meals } from '@gym/db';
import { isMealAvailableForDate, ktmDayOfWeek, type MealAvailabilitySlot } from '@gym/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { optimizedImageUrl } from '@/lib/video/cloudinaryProvider';

export const runtime = 'nodejs';

/**
 * Member menu browse (§8). Lists a partner's orderable meals, optionally
 * narrowed by goal tag, diet type, and a specific delivery slot's availability.
 * Only ACTIVE, non-deleted meals of an ACTIVE partner are ever returned.
 */

/**
 * Widest a meal photo is ever painted: the 88dp menu thumbnail (MealThumb on
 * apps/mobile .../meals/[partnerId].tsx), so ~264px on a 3x screen. Partner
 * uploads are phone-camera originals, and a twenty-meal menu shipped every one
 * of them at full resolution into that thumbnail. `optimizedImageUrl` caps the
 * delivered width and negotiates format/quality on the way out — the stored URL
 * is untouched, and a signed/foreign/already-transformed URL is passed through
 * exactly as it is.
 */
const MEAL_PHOTO_MAX_WIDTH = 320;

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
    .select({ id: mealPartners.id, acceptingOrders: mealPartners.acceptingOrders })
    .from(mealPartners)
    .where(and(eq(mealPartners.id, partnerId), eq(mealPartners.isActive, true)))
    .limit(1);
  // `acceptingOrders` is ADDITIVE alongside the frozen `meals` array: the
  // partner's operational pause, so a client can render the menu read-only
  // ("Closed right now") instead of letting a member build a cart that
  // checkout will reject. An unknown/deactivated partner reads as closed.
  if (!partner) return json({ meals: [], acceptingOrders: false }, 200);

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
      slotCapacity: meals.slotCapacity,
    })
    .from(meals)
    .where(and(...predicates))
    .orderBy(asc(meals.sortOrder), asc(meals.name));

  // Goal filter is over the array column — done in-process on the (small) menu.
  let result = goal ? rows.filter((m) => m.goalTags.includes(goal)) : rows;

  // Availability filter + Pack F sold-out surfacing: keep only meals orderable
  // for the requested slot (a meal with no availability rows is always-available)
  // and mark those the partner has toggled sold-out for THIS (dayOfWeek, window)
  // so the client can render them disabled instead of hiding them silently.
  const soldOutIds = new Set<string>();
  if (date && window && result.length > 0) {
    const ids = result.map((m) => m.id);
    const availRows = await db
      .select({
        mealId: mealAvailability.mealId,
        dayOfWeek: mealAvailability.dayOfWeek,
        window: mealAvailability.window,
        soldOut: mealAvailability.soldOut,
      })
      .from(mealAvailability)
      .where(inArray(mealAvailability.mealId, ids));
    const byMeal = new Map<string, MealAvailabilitySlot[]>();
    const dow = ktmDayOfWeek(date);
    for (const a of availRows) {
      const list = byMeal.get(a.mealId) ?? [];
      list.push({ dayOfWeek: a.dayOfWeek, window: a.window });
      byMeal.set(a.mealId, list);
      if (a.soldOut && a.dayOfWeek === dow && a.window === window) soldOutIds.add(a.mealId);
    }
    result = result.filter((m) => isMealAvailableForDate(byMeal.get(m.id) ?? [], date, window));
  }

  return json(
    {
      meals: result.map((m) => ({
        ...m,
        imageUrl: m.imageUrl === null ? null : optimizedImageUrl(m.imageUrl, { maxWidth: MEAL_PHOTO_MAX_WIDTH }),
        soldOut: soldOutIds.has(m.id),
      })),
      acceptingOrders: partner.acceptingOrders,
    },
    200,
  );
}
