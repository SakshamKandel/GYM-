import { mealSubscriptions } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { quoteSubscriptionPlan, subscriptionPaymentMutationBlock } from '@/lib/meals';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    window: z.enum(['lunch', 'dinner']),
    planType: z.enum(['fixed_meal', 'partner_rotating']),
    mealId: z.string().min(1).nullable(),
    addressId: z.string().min(1),
  })
  .strict();

export function OPTIONS() {
  return preflight();
}

/** Preview only. PATCH re-runs the same quote and never trusts this amount. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'meals/subscriptions/quote',
    limit: 120,
    windowMs: 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { id } = await params;
  const db = getDb();

  const [subscription] = await db
    .select({
      id: mealSubscriptions.id,
      partnerId: mealSubscriptions.partnerId,
      paymentMethod: mealSubscriptions.paymentMethod,
      status: mealSubscriptions.status,
    })
    .from(mealSubscriptions)
    .where(and(eq(mealSubscriptions.id, id), eq(mealSubscriptions.accountId, me.id)))
    .limit(1);
  if (!subscription) return json({ error: 'not_found' }, 404);
  if (subscription.status === 'cancelled') return json({ error: 'not_active' }, 409);

  const paymentBlock = await subscriptionPaymentMutationBlock({
    db,
    subscriptionId: subscription.id,
    scope: { kind: 'remaining' },
  });
  if (paymentBlock) return json({ error: paymentBlock }, 409);

  const result = await quoteSubscriptionPlan({
    db,
    accountId: me.id,
    partnerId: subscription.partnerId,
    paymentMethod: subscription.paymentMethod,
    shape: {
      ...parsed.data,
      daysOfWeek: [...new Set(parsed.data.daysOfWeek)].sort((a, b) => a - b),
      mealId: parsed.data.planType === 'fixed_meal' ? parsed.data.mealId : null,
    },
  });
  if (!result.ok) return json({ error: result.error }, 400);

  return json({ quote: result.quote }, 200);
}
