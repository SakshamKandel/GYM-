import { ktmDateString } from '@gym/shared';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import {
  loadPartnerSubscriptionHeldMinor,
  loadSubscriptionForecast,
  loadSubscriptionRoster,
  type PartnerSubscriptionRow,
  type SubscriptionForecast,
} from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner subscription roster + demand forecast (§4.3 / WP-8). GET only.
 * `requirePartner` resolves the caller's OWN `partnerId` (and — post-WP-1 —
 * requires the effective `meals.own` + `orders.fulfill` permissions), so every
 * row is scoped to that restaurant; a foreign subscription is simply never
 * returned. Read-only: this route NEVER materializes orders or touches billing —
 * it reports the schedule and the already-computed billing-cycle state.
 *
 *  - roster   → masked-contact subscriber list (schedule, plan, price, status,
 *               this-week cycle). No member accountId/email leaves the layer.
 *  - forecast → forward-looking scheduled-slot demand over `weeks` KTM weeks,
 *               derived purely from daysOfWeek/startDate (+ skips).
 */

const querySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(12).default(4),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ weeks: url.searchParams.get('weeks') ?? undefined });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { weeks } = parsed.data;

  const db = getDb();
  const today = ktmDateString(new Date());
  const [roster, forecast, subscriptionHeldMinor]: [
    PartnerSubscriptionRow[],
    SubscriptionForecast,
    number,
  ] = await Promise.all([
    loadSubscriptionRoster(db, partnerId, today),
    loadSubscriptionForecast(db, partnerId, today, weeks),
    loadPartnerSubscriptionHeldMinor(db, partnerId),
  ]);

  // Prepaid-digital subscription revenue the PLATFORM currently holds for this
  // partner (Σ paid billing cycles) — a transparency figure for the roster page.
  return json({ roster, forecast, subscriptionHeldMinor }, 200);
}
