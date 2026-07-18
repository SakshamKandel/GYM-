import { meals } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';
import { deriveStoreState, loadPartnerMenu } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Store controls — vacation / pause switch (§3).
 *
 * No-schema design: the geo wave owns the `meal_partners` table, so we cannot
 * add an `acceptingOrders` column, and `meal_partners.isActive = false` is the
 * account KILL-SWITCH (it deletes sessions + bounces the partner out of their
 * own console via requirePartnerPage), so it is the wrong lever for a
 * self-serve pause. Instead PAUSE bulk-sets every non-deleted meal's
 * `isActive = false` and RESUME sets them back to true — the member order-create
 * route already requires `meals.isActive = true` for every line, so a paused
 * store rejects new orders server-side with no member-route change. "Paused" is
 * therefore derived as "has items but all hidden" ({@link deriveStoreState}).
 *
 * Documented limitation: because resume re-activates ALL items, any single item
 * a partner had individually marked out-of-stock is made available again on
 * resume; the client surfaces this before confirming. Existing orders are
 * untouched — pause only gates NEW orders.
 */

const bodySchema = z.object({ action: z.enum(['pause', 'resume']) });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const menu = await loadPartnerMenu(getDb(), partnerId);
  return json({ store: deriveStoreState(menu) }, 200);
}

export async function POST(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { principal, partnerId } = guard;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { action } = parsed.data;

  const db = getDb();
  const nextActive = action === 'resume';

  // Scoped bulk sweep — only THIS partner's live items flip. onlyPartnerId +
  // isDeleted=false keep the write inside the caller's own menu.
  const updated = await db
    .update(meals)
    .set({ isActive: nextActive, updatedAt: new Date() })
    .where(
      and(
        eq(meals.partnerId, partnerId),
        eq(meals.isDeleted, false),
        eq(meals.isActive, !nextActive),
      ),
    )
    .returning({ id: meals.id });

  await logAudit(
    principal,
    action === 'pause' ? 'partner.store.pause' : 'partner.store.resume',
    'partner',
    partnerId,
    { itemsSwept: updated.length },
    clientIp(req),
  );

  const menu = await loadPartnerMenu(db, partnerId);
  return json({ store: deriveStoreState(menu), itemsSwept: updated.length }, 200);
}
