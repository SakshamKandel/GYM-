import { ORDER_STATUSES, type OrderStatus } from '@gym/shared';
import { z } from 'zod';
import { loadAdminOrders, loadOrderStatusCounts } from '@/app/admin/orders/_data';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { materializeDueOrders } from '@/lib/meals';

export const runtime = 'nodejs';

/**
 * Admin all-partner order oversight list (plan §2/§3/§7 P6). Guarded by
 * `orders.review` (super_admin/main_admin bypass only, delegable via
 * override). This is also a materialization trigger point (§3 — "runs at the
 * top of every order-list route"), so an admin viewing the board sees
 * subscription orders that are due but not yet spawned for ANY partner.
 *
 *  - date       optional exact deliveryDate filter (YYYY-MM-DD)
 *  - partnerId  optional exact-partner filter
 *  - status     optional exact-status filter
 *  - scope      active (default, non-terminal) | history (terminal) | all
 */

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  partnerId: z.string().trim().min(1).optional(),
  status: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]).optional(),
  scope: z.enum(['active', 'history', 'all']).default('active'),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'orders.review');
  if (principal instanceof Response) return principal;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get('date') ?? undefined,
    partnerId: url.searchParams.get('partnerId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  await materializeDueOrders(db, { kind: 'all' });

  const [orders, statusCounts] = await Promise.all([
    loadAdminOrders(db, parsed.data),
    loadOrderStatusCounts(db),
  ]);

  return json({ orders, statusCounts }, 200);
}
