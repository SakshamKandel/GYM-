import { mealDisputes, mealOrders } from '@gym/db';
import {
  canAdvanceDispute,
  DISPUTE_STATUSES,
  maskPii,
  orderNumber,
  type DisputeStatus,
} from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin dispute resolve/reject (Pack E; §7.2-S3). CAS status transition through
 * {@link canAdvanceDispute} (open→reviewing/resolved/rejected; reviewing→
 * resolved/rejected). ADMIN-AUTHORITATIVE AND NEVER AUTO-REFUNDS: this route
 * only records the outcome and tells the member — an admin who decides money
 * should move back does so separately via the existing meal-payments refund
 * rail (`POST /api/admin/meal-payments/[id]/refund`), which already carries its
 * own idempotent reversal + audit. `resolution` is `maskPii`'d before store
 * (mirrors the schema doc comment — a defense-in-depth pass even though this
 * text is staff-authored, in case a reviewer pastes a customer detail).
 *
 * Guarded by `orders.review` — same permission as the order board and the
 * member-side dispute route's staff `notify` target.
 */

const bodySchema = z.object({
  toStatus: z.enum(DISPUTE_STATUSES as unknown as [DisputeStatus, ...DisputeStatus[]]),
  resolution: z.string().trim().max(1000).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'orders.review');
  if (principal instanceof Response) return principal;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { toStatus, resolution } = parsed.data;

  const db = getDb();
  const [dispute] = await db
    .select({
      id: mealDisputes.id,
      orderId: mealDisputes.orderId,
      accountId: mealDisputes.accountId,
      status: mealDisputes.status,
    })
    .from(mealDisputes)
    .where(eq(mealDisputes.id, id))
    .limit(1);
  if (!dispute) return json({ error: 'not_found' }, 404);

  const from = dispute.status as DisputeStatus;
  if (!canAdvanceDispute(from, toStatus)) {
    return json({ error: 'illegal_transition' }, 409);
  }

  const maskedResolution = resolution ? maskPii(resolution) : null;
  const isTerminal = toStatus === 'resolved' || toStatus === 'rejected';

  const updated = await db
    .update(mealDisputes)
    .set({
      status: toStatus,
      resolution: maskedResolution,
      decidedBy: principal.id,
      decidedAt: isTerminal ? new Date() : null,
    })
    .where(and(eq(mealDisputes.id, id), eq(mealDisputes.status, from)))
    .returning({ id: mealDisputes.id });
  if (!updated[0]) return json({ error: 'conflict' }, 409);

  await logAudit(
    principal,
    'meal_dispute.decide',
    'meal_dispute',
    id,
    { from, to: toStatus, orderId: dispute.orderId, resolution: maskedResolution },
    clientIp(req),
  );

  if (isTerminal) {
    const [order] = await db
      .select({ id: mealOrders.id })
      .from(mealOrders)
      .where(eq(mealOrders.id, dispute.orderId))
      .limit(1);
    const code = order ? orderNumber(order.id) : orderNumber(dispute.orderId);
    const outcome = toStatus === 'resolved' ? 'resolved' : 'reviewed — no further action';
    const body = maskedResolution
      ? `Your report on order ${code} was ${outcome}: ${maskedResolution}`
      : `Your report on order ${code} was ${outcome}.`;
    after(() =>
      notify(
        'order_status',
        { accountId: dispute.accountId },
        { title: 'Order dispute update', body, data: { type: 'order', id: dispute.orderId } },
      ),
    );
  }

  return json({ ok: true, status: toStatus }, 200);
}
