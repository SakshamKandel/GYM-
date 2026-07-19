import { mealDisputes, mealOrders } from '@gym/db';
import { canOpenDispute, isDisputeReason, maskPii, orderNumber } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/meals/orders/[id]/dispute — a member raises a problem with an order
 * (Pack E non-delivery rail; §7.2-S3).
 *
 * Guards: the caller must OWN the order; a dispute is openable ONLY from a
 * terminal delivered/paid state ({@link canOpenDispute}); the DB partial-unique
 * (`open|reviewing`) makes a second live dispute a 409, not a spam row; and the
 * route is rate-limited. Resolution is ADMIN-authoritative and NEVER auto-refunds
 * — this endpoint only files the case and pings staff. `note` is `maskPii`'d, and
 * when echoed to staff it is attributed ("Member note: …"), never platform text.
 */

const bodySchema = z.object({
  reason: z.string().min(1),
  note: z.string().trim().max(1000).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'meals/dispute',
    limit: 10,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  if (!isDisputeReason(parsed.data.reason)) return json({ error: 'invalid' }, 400);
  const reason = parsed.data.reason;

  const db = getDb();
  const [order] = await db
    .select({
      id: mealOrders.id,
      accountId: mealOrders.accountId,
      status: mealOrders.status,
      paymentStatus: mealOrders.paymentStatus,
    })
    .from(mealOrders)
    .where(and(eq(mealOrders.id, id), eq(mealOrders.accountId, me.id)))
    .limit(1);
  if (!order) return json({ error: 'not_found' }, 404);
  if (!canOpenDispute(order.status, order.paymentStatus)) {
    return json({ error: 'not_disputable' }, 409);
  }

  const maskedNote = parsed.data.note ? maskPii(parsed.data.note) : '';
  // Partial-unique(orderId) where status in ('open','reviewing') → a second live
  // dispute inserts 0 rows (DO NOTHING catches the partial unique).
  const inserted = await db
    .insert(mealDisputes)
    .values({ orderId: order.id, accountId: me.id, reason, note: maskedNote, status: 'open' })
    .onConflictDoNothing()
    .returning({ id: mealDisputes.id });
  if (inserted.length === 0) return json({ error: 'dispute_exists' }, 409);

  const code = orderNumber(order.id);
  after(() =>
    notify(
      'order_dispute_staff',
      { role: 'staff', permission: 'orders.review' },
      {
        title: 'New order dispute',
        body: maskedNote
          ? `Order ${code} disputed (${reason}). Member note: ${maskedNote}`
          : `Order ${code} disputed (${reason}).`,
        data: { type: 'order', id: order.id },
      },
    ),
  );

  return json({ dispute: { id: inserted[0].id, status: 'open', reason } }, 201);
}
