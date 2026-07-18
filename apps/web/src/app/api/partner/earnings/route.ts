import { ktmAddDays, ktmDateString } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { mealPartners } from '@gym/db';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { loadPartnerEarnings } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner earnings summary (§3 / §8). Sum of `totalMinor` over the caller's OWN
 * delivered orders in the trailing range, bucketed by delivery date. Only
 * `delivered` orders count (cancelled/refused never do). Scoped by the
 * requirePartner-derived partnerId.
 */

const querySchema = z.object({ range: z.enum(['7', '30', '90']).default('30') });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ range: url.searchParams.get('range') ?? undefined });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const days = Number(parsed.data.range);

  const db = getDb();
  const [partner] = await db
    .select({ currency: mealPartners.currency })
    .from(mealPartners)
    .where(and(eq(mealPartners.id, partnerId)))
    .limit(1);

  const today = ktmDateString(new Date());
  const sinceDate = ktmAddDays(today, -(days - 1));
  const earnings = await loadPartnerEarnings(db, partnerId, sinceDate, partner?.currency ?? 'NPR');

  return json(earnings, 200);
}
