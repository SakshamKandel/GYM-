import { mealPartners } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member meal-partner discovery (§8). Active partners only; the response is the
 * frozen public shape — no accountId, contact or internal flags leak.
 */
export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const rows = await getDb()
    .select({
      id: mealPartners.id,
      name: mealPartners.name,
      serviceAreas: mealPartners.serviceAreas,
      // Geo reach (additive): the kitchen origin + delivery radius let clients
      // distance-gate a saved address against a partner (withinRadiusKm). All
      // nullable — a partner that hasn't set a geo origin simply omits them.
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
      acceptsCod: mealPartners.acceptsCod,
      currency: mealPartners.currency,
    })
    .from(mealPartners)
    .where(eq(mealPartners.isActive, true))
    .orderBy(asc(mealPartners.name));

  return json({ partners: rows }, 200);
}
