import { accounts, paymentRequests } from '@gym/db';
import { resolveRegion } from '@gym/shared';
import { count, desc, eq, ne } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Admin console — the Nepal manual-payment queue (SCALE-UP-PLAN §1.5 / §4.1).
 *
 *  - GET `?status=pending|approved|rejected` → every request (optionally
 *    filtered), newest first, joined to the submitting account (id/email/
 *    displayName/tier — staff-only view, so the email exposure here is fine
 *    per §6 rule 3's MEMBER-FACING restriction). `receiptUrl` is re-minted as
 *    a fresh SIGNED Cloudinary url from the stored uid on every read (never
 *    cached) — when the image provider isn't configured, falls back to
 *    `unsigned:<uid>` so the row is still visible/actionable instead of the
 *    whole list 503ing.
 *
 * Response shape (C-D, mobile contract): `{ rows, counts: { pending } }`.
 * PENDING is loaded UNBOUNDED (up to a high safety ceiling) so an old pending
 * request can never starve invisibly behind a flat newest-N cap (P0-6); decided
 * history is capped. `counts.pending` is an authoritative COUNT so the mobile
 * badge is accurate even when the pending list is (implausibly) truncated.
 *
 * Guarded by requirePermission('payments.review'); super_admin/main_admin pass.
 */

// PENDING_CAP is a very high safety ceiling, not an expected working-set size.
const PENDING_CAP = 2000;
const DECIDED_CAP = 200;
const STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'payments.review');
  if (principal instanceof Response) return principal;

  const statusParam = new URL(req.url).searchParams.get('status');
  const status = (STATUSES as readonly string[]).includes(statusParam ?? '')
    ? (statusParam as (typeof STATUSES)[number])
    : undefined;

  const db = getDb();

  const selectRows = (where: ReturnType<typeof eq> | undefined, cap: number) =>
    db
      .select({
        id: paymentRequests.id,
        accountId: accounts.id,
        email: accounts.email,
        displayName: accounts.displayName,
        tierNow: accounts.tier,
        tierExpiresAt: accounts.tierExpiresAt,
        country: accounts.country,
        tier: paymentRequests.tier,
        months: paymentRequests.months,
        region: paymentRequests.region,
        amountMinor: paymentRequests.amountMinor,
        currency: paymentRequests.currency,
        method: paymentRequests.method,
        receiptUid: paymentRequests.receiptUrl,
        note: paymentRequests.note,
        status: paymentRequests.status,
        reviewNote: paymentRequests.reviewNote,
        createdAt: paymentRequests.createdAt,
      })
      .from(paymentRequests)
      .innerJoin(accounts, eq(accounts.id, paymentRequests.accountId))
      .where(where)
      .orderBy(desc(paymentRequests.createdAt))
      .limit(cap);

  // Pending never starves (P0-6): loaded unbounded up to PENDING_CAP; decided
  // history capped. When a specific status is requested, honour it with the
  // matching cap; with no filter, pending-unbounded + decided-capped.
  const [rows, pendingCountRow] = await Promise.all([
    status === 'pending'
      ? selectRows(eq(paymentRequests.status, 'pending'), PENDING_CAP)
      : status
        ? selectRows(eq(paymentRequests.status, status), DECIDED_CAP)
        : (async () => {
            const [pending, decided] = await Promise.all([
              selectRows(eq(paymentRequests.status, 'pending'), PENDING_CAP),
              selectRows(ne(paymentRequests.status, 'pending'), DECIDED_CAP),
            ]);
            return [...pending, ...decided];
          })(),
    db
      .select({ n: count() })
      .from(paymentRequests)
      .where(eq(paymentRequests.status, 'pending')),
  ]);
  const pendingCount = Number(pendingCountRow[0]?.n ?? 0);

  const provider = getVideoProvider();
  const shaped = await Promise.all(
    rows.map(async (r) => {
      let receiptUrl: string;
      try {
        receiptUrl = await provider.signedImageUrl(r.receiptUid);
      } catch (err) {
        if (!(err instanceof NotConfiguredError)) throw err;
        receiptUrl = `unsigned:${r.receiptUid}`;
      }
      return {
        id: r.id,
        account: {
          id: r.accountId,
          email: r.email,
          displayName: r.displayName,
          tier: r.tierNow,
          tierExpiresAt: r.tierExpiresAt ? r.tierExpiresAt.toISOString() : null,
        },
        tier: r.tier,
        months: r.months,
        region: r.region,
        // B11: NP pricing with no verified NP country (allowed via an
        // esewa/khalti rail) — flag it so the reviewer eyeballs the receipt
        // currency rather than trusting a self-reported cheap region.
        selfReportedRegion: r.region === 'NP' && resolveRegion(r.country) !== 'NP',
        amountMinor: r.amountMinor,
        currency: r.currency,
        method: r.method,
        receiptUrl,
        note: r.note,
        status: r.status,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt,
      };
    }),
  );

  return json({ rows: shaped, counts: { pending: pendingCount } }, 200);
}
