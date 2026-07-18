import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { loadOrderDetail } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner order detail (§2 / §3). GET only. `requirePartner` resolves the
 * caller's OWN partnerId; {@link loadOrderDetail} scopes the lookup to it, so a
 * foreign or non-existent order id is indistinguishable → 404 (no IDOR oracle).
 * Returns the STRICT partner projection (never the member's accountId / email /
 * tier) plus the append-only status timeline for the detail drawer.
 */
export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const { id } = await ctx.params;
  const detail = await loadOrderDetail(getDb(), partnerId, id);
  if (!detail) return json({ error: 'not_found' }, 404);

  return json({ order: detail }, 200);
}
