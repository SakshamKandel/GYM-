import { mealOrderRatings, mealOrders } from '@gym/db';
import { maskPii, starsSchema } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * POST /api/meals/orders/[id]/rating — a member's post-delivery rating (Pack C).
 *
 * Authz (§7.2-S6, review-bomb defense): the caller must OWN the order AND the
 * order must be `delivered` — you cannot rate a meal you never received. The
 * `unique(orderId)` index blocks re-rating (a second submit is a 409, not a
 * duplicate row). `note` is `maskPii`'d before store. Aggregation into a partner
 * score is a read-side concern (partnerRatingAggregate) handled by discovery.
 */

const bodySchema = z.object({
  stars: starsSchema,
  note: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const [order] = await db
    .select({
      id: mealOrders.id,
      accountId: mealOrders.accountId,
      partnerId: mealOrders.partnerId,
      status: mealOrders.status,
    })
    .from(mealOrders)
    .where(eq(mealOrders.id, id))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);
  if (order.accountId !== me.id) return json({ error: 'forbidden' }, 403);
  if (order.status !== 'delivered') return json({ error: 'not_delivered' }, 409);

  const inserted = await db
    .insert(mealOrderRatings)
    .values({
      orderId: order.id,
      accountId: me.id,
      partnerId: order.partnerId,
      stars: parsed.data.stars,
      note: parsed.data.note ? maskPii(parsed.data.note) : '',
    })
    .onConflictDoNothing()
    .returning({ id: mealOrderRatings.id });
  if (inserted.length === 0) return json({ error: 'already_rated' }, 409);

  return json({ ok: true, id: inserted[0].id }, 201);
}
