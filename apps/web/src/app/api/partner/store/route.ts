import { mealPartners } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';
import { partnerOperationLockSql } from '@/lib/partnerOperationLock';
import { deriveStoreState, loadPartnerMenu } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Store controls — vacation / pause switch (§3).
 *
 * `meal_partners.acceptingOrders` is an operational switch, independent of the
 * account kill-switch (`isActive`) and each dish's stock flag (`meals.isActive`).
 * Pause therefore blocks every create path without changing the menu; resuming
 * preserves items the partner deliberately marked out of stock. Existing orders
 * are untouched and must still be fulfilled.
 */

const bodySchema = z.object({ action: z.enum(['pause', 'resume']) });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const db = getDb();
  const [partner] = await db
    .select({ acceptingOrders: mealPartners.acceptingOrders })
    .from(mealPartners)
    .where(eq(mealPartners.id, partnerId))
    .limit(1);
  if (!partner) return json({ error: 'not_found' }, 404);

  const menu = await loadPartnerMenu(db, partnerId);
  return json({ store: deriveStoreState(menu, partner.acceptingOrders) }, 200);
}

export async function POST(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { principal, partnerId } = guard;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { action } = parsed.data;

  const db = getDb();
  const acceptingOrders = action === 'resume';

  // The shared partner lock serializes pause/resume with order creation. The
  // scoped CAS stays idempotent and never changes menu inventory.
  const updateQuery = db
    .update(mealPartners)
    .set({ acceptingOrders, updatedAt: new Date() })
    .where(
      and(
        eq(mealPartners.id, partnerId),
        eq(mealPartners.acceptingOrders, !acceptingOrders),
      ),
    )
    .returning({ id: mealPartners.id });
  const updated = (
    await db.batch([
      db.execute(partnerOperationLockSql(partnerId)),
      updateQuery,
    ])
  )[1];

  await logAudit(
    principal,
    action === 'pause' ? 'partner.store.pause' : 'partner.store.resume',
    'partner',
    partnerId,
    { changed: updated.length > 0, acceptingOrders },
    clientIp(req),
  );

  const [[partner], menu] = await Promise.all([
    db
      .select({ acceptingOrders: mealPartners.acceptingOrders })
      .from(mealPartners)
      .where(eq(mealPartners.id, partnerId))
      .limit(1),
    loadPartnerMenu(db, partnerId),
  ]);
  if (!partner) return json({ error: 'not_found' }, 404);
  return json(
    { store: deriveStoreState(menu, partner.acceptingOrders), itemsSwept: 0 },
    200,
  );
}
