import { ORDER_STATUSES, type OrderStatus } from '@gym/shared';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { materializeDueOrders } from '@/lib/meals';
import { loadActiveOrders, loadHistoryOrders, type PartnerOrderView } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner order queue (§3 / §8). GET only. `requirePartner` resolves the caller's
 * OWN `partnerId` — every row is scoped to it, so a foreign order is simply not
 * returned (never a leak). Materializes any due subscription orders first (the
 * partner queue is one of the on-read materialization trigger points), then
 * serves the STRICT partner projection (no member accountId/email/tier).
 *
 *  - scope=active (default) → non-terminal orders, oldest-cutoff first.
 *  - scope=history          → delivered/cancelled/refused, newest first.
 *  - status=<OrderStatus>   → optional exact-status filter over the active set.
 */

const querySchema = z.object({
  scope: z.enum(['active', 'history']).default('active'),
  status: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    scope: url.searchParams.get('scope') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { scope, status } = parsed.data;

  const db = getDb();
  // The partner queue is a materialization trigger point (§3, no cron).
  await materializeDueOrders(db, { kind: 'partner', partnerId });

  let orders: PartnerOrderView[] =
    scope === 'history'
      ? await loadHistoryOrders(db, partnerId)
      : await loadActiveOrders(db, partnerId);
  if (status) orders = orders.filter((o) => o.status === status);

  return json({ orders }, 200);
}
