import { accounts, paymentRequests } from '@gym/db';
import { applyDiscount, maskPii, resolveRegion } from '@gym/shared';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { bestActiveGrant, resolveCatalogAmount } from '@/lib/promoEconomy';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member-submitted manual payment requests (SCALE-UP-PLAN §1.5 / §4.1) — the
 * Nepal eSewa/Khalti/bank queue: pick a tier + duration, upload a receipt,
 * submit; an admin approves or rejects (POST /api/admin/payment-requests/[id]).
 *
 *  - POST {tier, months, method, receiptUrl, note?, region?} → computes
 *    amountMinor SERVER-side (never trust a client-supplied price): resolves
 *    the monthly catalog price for the account's region (an explicit `region`
 *    hint wins over the stored accounts.country, exactly like
 *    GET /api/subscription/catalog's resolution order — but this route does
 *    NOT persist the hint back to accounts.country, since that's the
 *    catalog endpoint's job), multiplies by `months`, then applies this
 *    account's best active discount grant (if any) — same order
 *    settlePromoOnPurchase uses at approval time, so the price shown here is
 *    exactly what gets settled later. Rate-limited 5/day/account.
 *  - GET → the caller's own requests, newest first.
 *
 * `receiptUrl` is actually the Cloudinary `uid` returned by
 * POST /api/uploads/image {kind:'payment_receipt'} (always access:
 * 'authenticated' — never a public URL). Validated against that kind's exact
 * uid shape (`payment_receipt/<uuid>`) so a client can't smuggle a uid minted
 * for a different kind into this column. The admin list route mints a fresh
 * signed URL from it per request.
 *
 * `note` is free member text — masked via maskPii before storage per
 * SCALE-UP-PLAN §4.1's PII-masking list.
 */

const RECEIPT_UID_PATTERN = /^payment_receipt\/[0-9a-f-]{36}$/;

const bodySchema = z.object({
  tier: z.enum(['silver', 'gold', 'elite']),
  months: z.union([z.literal(1), z.literal(3), z.literal(12)]),
  method: z.enum(['esewa', 'khalti', 'bank', 'other']),
  receiptUrl: z.string().trim().regex(RECEIPT_UID_PATTERN),
  note: z.string().trim().max(500).optional(),
  region: z.string().trim().min(2).max(8).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'payments/requests',
    limit: 5,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { tier, months, method, receiptUrl, note, region: regionHint } = parsed.data;

  const db = getDb();

  // Region resolution order matches GET /api/subscription/catalog: an
  // explicit hint wins over the stored country, else 'INTL'. Resolved here
  // (not left to resolveCatalogAmount's internal lookup) so the SAME region
  // value both prices the request and gets persisted to payment_requests.region.
  const [account] = await db
    .select({ country: accounts.country })
    .from(accounts)
    .where(eq(accounts.id, me.id))
    .limit(1);
  const region = resolveRegion(regionHint ?? account?.country ?? null);

  const { amountMinor: monthlyBase, currency } = await resolveCatalogAmount(me.id, tier, region);

  const baseTotal = monthlyBase * months;
  const grant = await bestActiveGrant(me.id);
  const amountMinor = grant ? applyDiscount(baseTotal, grant.pct) : baseTotal;

  const [inserted] = await db
    .insert(paymentRequests)
    .values({
      accountId: me.id,
      tier,
      months,
      region,
      amountMinor,
      currency,
      method,
      receiptUrl,
      note: note ? maskPii(note) : null,
    })
    .returning({
      id: paymentRequests.id,
      status: paymentRequests.status,
      amountMinor: paymentRequests.amountMinor,
      currency: paymentRequests.currency,
    });

  if (!inserted) return json({ error: 'invalid' }, 400);

  return json(inserted, 201);
}

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const rows = await db
    .select({
      id: paymentRequests.id,
      tier: paymentRequests.tier,
      months: paymentRequests.months,
      amountMinor: paymentRequests.amountMinor,
      currency: paymentRequests.currency,
      method: paymentRequests.method,
      status: paymentRequests.status,
      reviewNote: paymentRequests.reviewNote,
      createdAt: paymentRequests.createdAt,
    })
    .from(paymentRequests)
    .where(eq(paymentRequests.accountId, me.id))
    .orderBy(desc(paymentRequests.createdAt));

  return json({ requests: rows }, 200);
}
