import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { quoteSubscriptionPlan, type SubscriptionPlanShape } from '@/lib/meals';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/meals/plan-quote — price a weekly meal plan BEFORE it exists.
 *
 * A member could previously only learn what a plan costs per day by creating
 * it: POST /subscriptions computed `pricePerDayMinor` server-side and the
 * signup screen showed nothing. The edit form already had a preview
 * (/subscriptions/[id]/quote), but that needs a subscription id, so the one
 * screen where the price matters most — the one where you commit to a
 * recurring charge — had none.
 *
 * This is that missing preview, and it is the SAME `quoteSubscriptionPlan` the
 * create path runs, so what the member is shown is what the server will charge
 * (create re-quotes and never trusts anything sent here). Nothing is written
 * and no money moves; a plan whose shape create would reject fails here with
 * create's own error code, so the signup form can say why before the member
 * commits.
 */

const bodySchema = z.object({
  partnerId: z.string().min(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  window: z.enum(['lunch', 'dinner']),
  planType: z.enum(['fixed_meal', 'partner_rotating']),
  mealId: z.string().min(1).nullable().optional(),
  addressId: z.string().min(1),
  paymentMethod: z.enum(['esewa', 'khalti', 'cod']),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  // Fires on a debounce as the member edits the plan's shape, so the ceiling is
  // generous but still bounded per-account + per-IP.
  const limited = rateLimit({
    route: 'meals/plan-quote',
    limit: 240,
    windowMs: 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { partnerId, window, planType, addressId, paymentMethod } = parsed.data;

  const shape: SubscriptionPlanShape = {
    daysOfWeek: [...new Set(parsed.data.daysOfWeek)].sort((a, b) => a - b),
    window,
    planType,
    mealId: planType === 'fixed_meal' ? (parsed.data.mealId ?? null) : null,
    addressId,
  };

  const result = await quoteSubscriptionPlan({
    db: getDb(),
    accountId: me.id,
    partnerId,
    paymentMethod,
    shape,
  });
  if (!result.ok) return json({ error: result.error }, 400);

  // Same envelope as /subscriptions/[id]/quote so one client parser covers both.
  return json({ quote: result.quote }, 200);
}
