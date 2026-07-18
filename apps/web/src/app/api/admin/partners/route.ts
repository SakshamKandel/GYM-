import { accounts, admins, meals, mealOrders, mealPartners } from '@gym/db';
import { latSchema, lngSchema, TERMINAL_ORDER_STATUSES } from '@gym/shared';
import { and, asc, count, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin meal-partner roster (plan §2/§6/§7 P6). Guarded by `partners.manage`
 * (super_admin/main_admin bypass only — not in any sub-role preset, delegable
 * only via a per-account override, per plan §8). This is the ONLY way a
 * `partner`-role account is ever minted: a partner can never be granted through
 * the generic `POST /api/admin/staff` route (excluded from GRANTABLE_ROLES).
 *
 *  - GET  → every partner with its login account's email/status plus a live
 *    menu-item count and active (non-terminal) order count, for the roster
 *    table's at-a-glance columns.
 *  - POST → creates the login + partner row in the ORDER-SENSITIVE sequence the
 *    plan requires (neon-http has no transactions, so this is a manual
 *    saga): hashPassword → INSERT accounts → INSERT meal_partners → INSERT
 *    admins LAST. If either of the last two steps throws, the accounts row
 *    (and any partial meal_partners row under it) is deleted as cleanup — a
 *    partner is never left half-created with a consumed email and no way to
 *    log in anywhere.
 */

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(200),
  contact: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  addressText: z.string().trim().max(500).default(''),
  serviceAreas: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  serviceLat: latSchema.nullable().optional(),
  serviceLng: lngSchema.nullable().optional(),
  serviceRadiusKm: z.number().finite().min(0).max(200).nullable().optional(),
  acceptsCod: z.boolean().default(true),
  currency: z.enum(['NPR', 'USD']).default('NPR'),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const db = getDb();
  const rows = await db
    .select({
      id: mealPartners.id,
      accountId: mealPartners.accountId,
      name: mealPartners.name,
      contact: mealPartners.contact,
      phone: mealPartners.phone,
      addressText: mealPartners.addressText,
      serviceAreas: mealPartners.serviceAreas,
      serviceLat: mealPartners.serviceLat,
      serviceLng: mealPartners.serviceLng,
      serviceRadiusKm: mealPartners.serviceRadiusKm,
      acceptsCod: mealPartners.acceptsCod,
      currency: mealPartners.currency,
      isActive: mealPartners.isActive,
      createdAt: mealPartners.createdAt,
      email: accounts.email,
      accountStatus: accounts.status,
    })
    .from(mealPartners)
    .innerJoin(accounts, eq(accounts.id, mealPartners.accountId))
    .orderBy(asc(mealPartners.name));

  const partnerIds = rows.map((r) => r.id);
  const menuCounts = new Map<string, number>();
  const activeOrderCounts = new Map<string, number>();

  if (partnerIds.length > 0) {
    const menuRows = await db
      .select({ partnerId: meals.partnerId, n: count() })
      .from(meals)
      .where(and(inArray(meals.partnerId, partnerIds), eq(meals.isDeleted, false)))
      .groupBy(meals.partnerId);
    for (const r of menuRows) menuCounts.set(r.partnerId, Number(r.n));

    const orderRows = await db
      .select({ partnerId: mealOrders.partnerId, n: count() })
      .from(mealOrders)
      .where(
        and(
          inArray(mealOrders.partnerId, partnerIds),
          notInArray(mealOrders.status, [...TERMINAL_ORDER_STATUSES]),
        ),
      )
      .groupBy(mealOrders.partnerId);
    for (const r of orderRows) activeOrderCounts.set(r.partnerId, Number(r.n));
  }

  return json(
    {
      partners: rows.map((r) => ({
        ...r,
        menuCount: menuCounts.get(r.id) ?? 0,
        activeOrders: activeOrderCounts.get(r.id) ?? 0,
      })),
    },
    200,
  );
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'partners.manage');
  if (principal instanceof Response) return principal;

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const {
    email,
    password,
    name,
    contact,
    phone,
    addressText,
    serviceAreas,
    serviceLat,
    serviceLng,
    serviceRadiusKm,
    acceptsCod,
    currency,
  } = parsed.data;

  const db = getDb();
  const passwordHash = await hashPassword(password);

  // Step 1: the login identity. CAS on the unique email so a race with any
  // other signup/create path can't silently overwrite an existing account.
  const insertedAccounts = await db
    .insert(accounts)
    .values({
      email,
      passwordHash,
      displayName: name,
      tier: 'starter',
      status: 'active',
    })
    .onConflictDoNothing({ target: accounts.email })
    .returning({ id: accounts.id });
  const accountId = insertedAccounts[0]?.id;
  if (!accountId) return json({ error: 'email_taken' }, 409);

  try {
    // Step 2: the restaurant row.
    const [partnerRow] = await db
      .insert(mealPartners)
      .values({
        accountId,
        name,
        contact,
        phone,
        addressText,
        serviceAreas,
        serviceLat: serviceLat ?? null,
        serviceLng: serviceLng ?? null,
        serviceRadiusKm: serviceRadiusKm ?? null,
        acceptsCod,
        currency,
      })
      .returning({ id: mealPartners.id });
    if (!partnerRow) throw new Error('meal_partners insert returned no row');

    // Step 3 (LAST, per plan §7): only once the partner row exists does the
    // account become staff — a failure before this point leaves a plain
    // member account, never a dangling 'partner' role with nothing behind it.
    await db.insert(admins).values({ accountId, role: 'partner' });

    await logAudit(
      principal,
      'partner.create',
      'meal_partners',
      partnerRow.id,
      { name, email },
      clientIp(req),
    );

    return json({ id: partnerRow.id, accountId }, 201);
  } catch (err) {
    console.error('[admin/partners] create failed after accounts insert, rolling back', err);
    // No transactions on neon-http: clean up manually. Deleting the accounts
    // row cascades to any partial meal_partners/admins row already written
    // under it, so the email is freed rather than left permanently consumed.
    try {
      await db.delete(accounts).where(eq(accounts.id, accountId));
    } catch (cleanupErr) {
      console.error('[admin/partners] cleanup delete failed', cleanupErr);
    }
    return json({ error: 'create_failed' }, 500);
  }
}
