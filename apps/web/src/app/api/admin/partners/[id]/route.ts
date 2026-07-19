import {
  mealBillingCycles,
  mealOrders,
  mealPartners,
  mealPaymentRequests,
  meals,
  mealSubscriptions,
  sessions,
} from '@gym/db';
import { latSchema, lngSchema } from '@gym/shared';
import { and, eq, inArray, notExists, or } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { partnerOperationLockSql } from '@/lib/partnerOperationLock';
import {
  partnerCurrencyChangeBlocked,
  PARTNER_LIVE_ORDER_STATUSES,
} from '@/lib/partnerAdminSafeguards';
import { loadPartnerAdminSafeguard } from '@/lib/partnerAdminSafeguardsDb';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin — edit or deactivate one meal partner (plan §2/§7 P6). Guarded by
 * `partners.manage` (super_admin/main_admin bypass only).
 *
 * A single PATCH covers both ordinary field edits and deactivation: setting
 * `isActive:false` on a currently-active row is a "deactivate" — per plan §7
 * this ALSO deletes every session for the partner's login account, a second
 * kill-switch alongside the isActive flag `requirePartner` checks on every
 * request (so a live token can't outrace the flip). Reactivating
 * (`isActive:true`) is a plain flag flip — no session action.
 */

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    contact: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    addressText: z.string().trim().max(500).optional(),
    serviceAreas: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    // Service-area geometry — center point + delivery reach (km). Nullable so an
    // admin can clear a previously-drawn area; the column names match 1:1 so the
    // `rest` spread flows straight into the update set.
    serviceLat: latSchema.nullable().optional(),
    serviceLng: lngSchema.nullable().optional(),
    serviceRadiusKm: z.number().finite().min(0).max(200).nullable().optional(),
    acceptsCod: z.boolean().optional(),
    currency: z.enum(['NPR', 'USD']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { isActive, ...rest } = parsed.data;

  const db = getDb();

  const [existing] = await db
    .select({
      id: mealPartners.id,
      accountId: mealPartners.accountId,
      currency: mealPartners.currency,
      isActive: mealPartners.isActive,
      updatedAt: mealPartners.updatedAt,
    })
    .from(mealPartners)
    .where(eq(mealPartners.id, id))
    .limit(1);
  if (!existing) return json({ error: 'not_found' }, 404);

  const deactivating = isActive === false && existing.isActive;
  const changingCurrency =
    rest.currency !== undefined && rest.currency !== existing.currency;
  const safeguards = await loadPartnerAdminSafeguard(db, id);

  if (
    partnerCurrencyChangeBlocked(
      existing.currency,
      rest.currency,
      safeguards.currencyHistory,
    )
  ) {
    return json(
      {
        error: 'currency_history_locked',
        currentCurrency: existing.currency,
        requestedCurrency: rest.currency,
        history: safeguards.currencyHistory,
      },
      409,
    );
  }

  if (deactivating && safeguards.liveOrders.total > 0) {
    return json(
      { error: 'partner_has_live_orders', liveOrders: safeguards.liveOrders },
      409,
    );
  }

  // CAS prevents two admins from overwriting one another. Repeating the history
  // and live-order checks in this UPDATE closes the normal pre-read/write race.
  // Deactivation also shares a transaction-scoped partner lock with one-time
  // order creation, so its NOT EXISTS snapshot cannot miss a racing commit.
  const predicates = [
    eq(mealPartners.id, id),
    eq(mealPartners.updatedAt, existing.updatedAt),
  ];

  if (changingCurrency) {
    predicates.push(
      notExists(db.select({ id: meals.id }).from(meals).where(eq(meals.partnerId, id))),
      notExists(
        db
          .select({ id: mealSubscriptions.id })
          .from(mealSubscriptions)
          .where(eq(mealSubscriptions.partnerId, id)),
      ),
      notExists(
        db
          .select({ id: mealBillingCycles.id })
          .from(mealBillingCycles)
          .innerJoin(
            mealSubscriptions,
            eq(mealSubscriptions.id, mealBillingCycles.subscriptionId),
          )
          .where(eq(mealSubscriptions.partnerId, id)),
      ),
      notExists(
        db.select({ id: mealOrders.id }).from(mealOrders).where(eq(mealOrders.partnerId, id)),
      ),
      notExists(
        db
          .select({ id: mealPaymentRequests.id })
          .from(mealPaymentRequests)
          .leftJoin(mealOrders, eq(mealOrders.id, mealPaymentRequests.orderId))
          .leftJoin(mealBillingCycles, eq(mealBillingCycles.id, mealPaymentRequests.cycleId))
          .leftJoin(
            mealSubscriptions,
            eq(mealSubscriptions.id, mealBillingCycles.subscriptionId),
          )
          .where(
            or(
              eq(mealOrders.partnerId, id),
              eq(mealSubscriptions.partnerId, id),
            ),
          ),
      ),
    );
  }

  if (deactivating) {
    predicates.push(
      notExists(
        db
          .select({ id: mealOrders.id })
          .from(mealOrders)
          .where(
            and(
              eq(mealOrders.partnerId, id),
              inArray(mealOrders.status, [...PARTNER_LIVE_ORDER_STATUSES]),
            ),
          ),
      ),
    );
  }

  const updateQuery = db
    .update(mealPartners)
    .set({
      ...rest,
      ...(isActive !== undefined ? { isActive } : {}),
      updatedAt: new Date(),
    })
    .where(and(...predicates))
    .returning();
  const updated = deactivating
    ? (
        await db.batch([
          db.execute(partnerOperationLockSql(id)),
          updateQuery,
        ])
      )[1]
    : await updateQuery;
  if (updated.length === 0) {
    const [current] = await db
      .select({ id: mealPartners.id, currency: mealPartners.currency })
      .from(mealPartners)
      .where(eq(mealPartners.id, id))
      .limit(1);
    if (!current) return json({ error: 'not_found' }, 404);

    const latest = await loadPartnerAdminSafeguard(db, id);
    if (
      changingCurrency &&
      partnerCurrencyChangeBlocked(
        current.currency,
        rest.currency,
        latest.currencyHistory,
      )
    ) {
      return json(
        {
          error: 'currency_history_locked',
          currentCurrency: current.currency,
          requestedCurrency: rest.currency,
          history: latest.currencyHistory,
        },
        409,
      );
    }
    if (deactivating && latest.liveOrders.total > 0) {
      return json(
        { error: 'partner_has_live_orders', liveOrders: latest.liveOrders },
        409,
      );
    }
    return json({ error: 'partner_edit_conflict' }, 409);
  }

  if (deactivating) {
    // Second kill-switch: any live console/mobile token for this login dies
    // immediately, rather than lingering until requirePartner next re-checks.
    await db.delete(sessions).where(eq(sessions.accountId, existing.accountId));
  }

  await logAudit(
    principal,
    deactivating ? 'partner.deactivate' : 'partner.update',
    'meal_partners',
    id,
    {
      fields: Object.keys(parsed.data),
      ...(changingCurrency
        ? { currencyFrom: existing.currency, currencyTo: rest.currency }
        : {}),
      ...(deactivating ? { liveOrdersAtDeactivation: 0 } : {}),
    },
    clientIp(req),
  );

  return json({ partner: updated[0] }, 200);
}
