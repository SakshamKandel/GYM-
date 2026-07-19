import { accounts, paymentRequests } from '@gym/db';
import { applyDiscount, formatMoney, maskPii, type PriceRegion, resolveRegion } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
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
 *    the monthly catalog price for the account's region (see the region gate
 *    below), multiplies by `months`, then applies this account's best active
 *    discount grant (if any). The discount context is SNAPSHOTTED onto the row
 *    (B3): promoCodeId, discountGrantId, discountPct, baseAmountMinor — so
 *    approval settles THAT exact grant against the frozen price regardless of
 *    later grant/catalog drift, and a single grant can back only ONE pending
 *    request (soft-reserved via the pending lookup below). Rate-limited
 *    5/day/account.
 *  - GET → the caller's own requests, newest first.
 *
 * Region gate (B11): a client-supplied `region` hint can no longer hand anyone
 * the cheap NPR catalog. An NP hint is honored only when the stored country
 * already verifies NP, OR the chosen rail is Nepal-specific (esewa/khalti). A
 * self-reported NP (no verified country) still prices in NPR but the admin
 * queue flags it (derived at read time from region vs stored country) so the
 * reviewer eyeballs the receipt currency. An INTL hint is never an exploit
 * (INTL is the pricier region) and is always honored.
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

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (error as { code?: unknown }).code === '23505';
}

export function OPTIONS() {
  return preflight();
}

/**
 * Resolves the pricing region for a submission, gating the cheap NP catalog
 * (B11). Returns the region actually used.
 *  - NP is granted only when the stored country verifies NP OR the rail is
 *    Nepal-specific (esewa/khalti); otherwise the NP hint is ignored and the
 *    stored country's region stands.
 *  - Any non-NP hint (INTL) is honored as-is (never an underpricing exploit).
 */
function resolveSubmissionRegion(
  regionHint: string | undefined,
  storedCountry: string | null,
  method: 'esewa' | 'khalti' | 'bank' | 'other',
): PriceRegion {
  const storedRegion = resolveRegion(storedCountry);
  if (!regionHint) return storedRegion;
  const hinted = resolveRegion(regionHint);
  if (hinted !== 'NP') return hinted; // INTL hint: always safe to honor.
  // NP hint: only honor with a verified NP country or a Nepal-specific rail.
  if (storedRegion === 'NP') return 'NP';
  if (method === 'esewa' || method === 'khalti') return 'NP';
  return storedRegion; // Unverified NP over a non-NP rail → ignore the hint.
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

  const [pendingRequest] = await db
    .select({ id: paymentRequests.id })
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.accountId, me.id),
        eq(paymentRequests.status, 'pending'),
      ),
    )
    .limit(1);
  if (pendingRequest) return json({ error: 'already_pending' }, 409);

  // Region resolution (B11): an NP hint is gated (see resolveSubmissionRegion);
  // the SAME resolved region both prices the request and gets persisted to
  // payment_requests.region. This route does NOT persist the hint back to
  // accounts.country (that's the catalog endpoint's job).
  const [account] = await db
    .select({ country: accounts.country })
    .from(accounts)
    .where(eq(accounts.id, me.id))
    .limit(1);
  const region = resolveSubmissionRegion(regionHint, account?.country ?? null, method);

  const { amountMinor: monthlyBase, currency } = await resolveCatalogAmount(me.id, tier, region);

  // Receipt reuse guard: the Cloudinary uid is unguessable per-upload, but a
  // member can re-submit the SAME genuine receipt on multiple requests (after a
  // grant lapses, or across several tiers at once) and each would be
  // independently approvable into its own tier grant. Reject a uid that already
  // backs any existing request so one payment can only ever fund one request;
  // an admin reviewing requests in isolation has no other signal that a receipt
  // is a reuse. The unique database index below is the concurrency-safe guard;
  // this read is only the friendly fast path.
  const [dupeReceipt] = await db
    .select({ id: paymentRequests.id })
    .from(paymentRequests)
    .where(eq(paymentRequests.receiptUrl, receiptUrl))
    .limit(1);
  if (dupeReceipt) return json({ error: 'receipt_already_used' }, 409);

  const baseTotal = monthlyBase * months;

  // Discount snapshot (B3). Freeze the pricing/settlement context at SUBMIT so
  // approval settles deterministically. A grant can back only ONE pending
  // request: if the account's best active grant is already snapshotted onto
  // another pending request it is treated as spoken-for and this request prices
  // at the base (no double-application; the reservation frees automatically once
  // the other request leaves 'pending', since this lookup only counts pending
  // rows). The neon-http driver has no transactions, so a rare same-account
  // concurrent double-submit could still both snapshot one grant — settlement
  // stays single-credit per (sourceType, sourceId) request id, and the 5/day
  // limit bounds the exposure.
  const grant = await bestActiveGrant(me.id);
  let discountGrantId: string | null = null;
  let discountPct: number | null = null;
  let promoCodeId: string | null = null;
  let amountMinor = baseTotal;
  if (grant) {
    const [reserved] = await db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.discountGrantId, grant.id),
          eq(paymentRequests.status, 'pending'),
        ),
      )
      .limit(1);
    if (!reserved) {
      discountGrantId = grant.id;
      discountPct = grant.pct;
      promoCodeId = grant.promoCodeId;
      amountMinor = applyDiscount(baseTotal, grant.pct);
    }
  }

  const insertRequest = async (withDiscount: boolean) => {
    const [result] = await db
      .insert(paymentRequests)
      .values({
        accountId: me.id,
        tier,
        months,
        region,
        amountMinor: withDiscount ? amountMinor : baseTotal,
        currency,
        method,
        receiptUrl,
        note: note ? maskPii(note) : null,
        promoCodeId: withDiscount ? promoCodeId : null,
        discountGrantId: withDiscount ? discountGrantId : null,
        discountPct: withDiscount ? discountPct : null,
        baseAmountMinor: baseTotal,
      })
      .returning({
        id: paymentRequests.id,
        status: paymentRequests.status,
        amountMinor: paymentRequests.amountMinor,
        currency: paymentRequests.currency,
      });
    return result;
  };

  let inserted: Awaited<ReturnType<typeof insertRequest>>;
  try {
    inserted = await insertRequest(discountGrantId !== null);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Resolve the winning constraint without trusting driver-specific names.
    const [receiptWinner] = await db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.receiptUrl, receiptUrl))
      .limit(1);
    if (receiptWinner) return json({ error: 'receipt_already_used' }, 409);
    const [pendingWinner] = await db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(
        and(
          eq(paymentRequests.accountId, me.id),
          eq(paymentRequests.status, 'pending'),
        ),
      )
      .limit(1);
    if (pendingWinner) return json({ error: 'already_pending' }, 409);
    if (discountGrantId === null) throw error;

    // Another pending request reserved the same grant first. This submission
    // remains valid, but is frozen at base price instead of double-discounting.
    try {
      inserted = await insertRequest(false);
    } catch (retryError) {
      if (!isUniqueViolation(retryError)) throw retryError;
      const [retryReceiptWinner] = await db
        .select({ id: paymentRequests.id })
        .from(paymentRequests)
        .where(eq(paymentRequests.receiptUrl, receiptUrl))
        .limit(1);
      if (retryReceiptWinner) return json({ error: 'receipt_already_used' }, 409);
      const [retryPendingWinner] = await db
        .select({ id: paymentRequests.id })
        .from(paymentRequests)
        .where(
          and(
            eq(paymentRequests.accountId, me.id),
            eq(paymentRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (retryPendingWinner) return json({ error: 'already_pending' }, 409);
      throw retryError;
    }
  }

  if (!inserted) return json({ error: 'invalid' }, 400);

  // B24 — confirm to the member and alert reviewers. Fire-and-forget: a notify
  // failure must never fail an already-persisted request. The member gets a
  // submit confirmation with the review SLA; staff with payments.review get a
  // new-work alert. The staff body is server-templated (no member free text →
  // no injection, §7.2-S2); the amount is the server-computed figure.
  const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
  const amountLabel = formatMoney(inserted.amountMinor, inserted.currency);
  void notify(
    'tier_payment_submitted',
    { accountId: me.id },
    {
      title: 'Payment submitted for review',
      body: `We received your ${tierName} membership payment (${amountLabel}). An admin will review your receipt within 24 hours.`,
      data: { type: 'tier' },
    },
  );
  void notify(
    'payment_request_staff',
    { role: 'staff', permission: 'payments.review' },
    {
      title: 'New membership payment',
      body: `A member submitted a ${amountLabel} ${tierName} payment for review.`,
      data: { type: 'payment_request', id: inserted.id },
    },
  );

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
