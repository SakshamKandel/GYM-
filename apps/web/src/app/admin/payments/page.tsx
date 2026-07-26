import { accounts, paymentRequests } from '@gym/db';
import { resolveRegion } from '@gym/shared';
import { desc, eq, ne, type SQL, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { getDb } from '@/lib/db';
import { effectivePermissionSet } from '@/lib/authz';
import { staffFromCookie } from '@/lib/staffSession';
import { getVideoProvider } from '@/lib/video';
import { DownloadCsv } from '../_components/DownloadCsv';
import {
  type PaymentRequestRow,
  type PaymentStatusCounts,
  PaymentsQueue,
} from './_components/PaymentsQueue';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Membership payments' };
export const dynamic = 'force-dynamic';

// Pending is loaded UNBOUNDED (B7 — old pending requests must never starve
// invisibly behind a flat newest-N cap); decided history is capped. PENDING_CAP
// is a very high safety ceiling, not an expected working-set size.
const PENDING_CAP = 2000;
const DECIDED_CAP = 200;

/**
 * Mints a viewable receipt URL from the stored value. The upload pipeline
 * (SCALE-UP-PLAN §4.5) stores payment receipts as an "authenticated"
 * Cloudinary asset — the DB column holds the opaque uid, never a public URL —
 * so a signed delivery URL must be minted per request via the configured
 * video/image provider. Defensive: if the stored value already looks like a
 * full URL (a future upload path, or hand-seeded test data) it's used as-is;
 * if signing fails for any reason (misconfigured host keys, bad uid) we
 * degrade to `null` rather than let one broken receipt crash the whole queue.
 */
async function resolveReceiptUrl(raw: string): Promise<string | null> {
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return await getVideoProvider().signedImageUrl(raw);
  } catch {
    return null;
  }
}

async function selectRequests(where: SQL, cap: number) {
  const db = getDb();
  return db
    .select({
      id: paymentRequests.id,
      accountId: paymentRequests.accountId,
      accountEmail: accounts.email,
      accountDisplayName: accounts.displayName,
      accountTier: accounts.tier,
      accountTierExpiresAt: accounts.tierExpiresAt,
      accountCountry: accounts.country,
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
      decidedAt: paymentRequests.decidedAt,
    })
    .from(paymentRequests)
    .innerJoin(accounts, eq(accounts.id, paymentRequests.accountId))
    .where(where)
    .orderBy(desc(paymentRequests.createdAt))
    .limit(cap);
}

type RawRow = Awaited<ReturnType<typeof selectRequests>>[number];

async function toRow(r: RawRow): Promise<PaymentRequestRow> {
  return {
    id: r.id,
    accountId: r.accountId,
    accountEmail: r.accountEmail,
    accountDisplayName: r.accountDisplayName,
    accountTier: r.accountTier as PaymentRequestRow['accountTier'],
    accountTierExpiresAt: r.accountTierExpiresAt ? r.accountTierExpiresAt.toISOString() : null,
    tier: r.tier as PaymentRequestRow['tier'],
    months: r.months,
    region: r.region as PaymentRequestRow['region'],
    // B11: NP pricing with no verified NP country — surface it so the reviewer
    // scrutinises the receipt currency rather than trusting a cheap self-report.
    selfReportedRegion: r.region === 'NP' && resolveRegion(r.accountCountry) !== 'NP',
    amountMinor: r.amountMinor,
    currency: r.currency,
    method: r.method as PaymentRequestRow['method'],
    receiptUrl: r.receiptUid ? await resolveReceiptUrl(r.receiptUid) : null,
    note: r.note,
    status: r.status as PaymentRequestRow['status'],
    reviewNote: r.reviewNote,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  };
}

/**
 * Loads pending requests unbounded + a capped slice of decided history, plus
 * accurate per-status counts (B7 — tiles/tabs computed over a grouped COUNT, not
 * a truncated page, so they never undercount).
 */
async function loadPaymentRequests(): Promise<{
  requests: PaymentRequestRow[];
  counts: PaymentStatusCounts;
}> {
  const db = getDb();
  const [pendingRaw, decidedRaw, countRows] = await Promise.all([
    selectRequests(eq(paymentRequests.status, 'pending'), PENDING_CAP),
    selectRequests(ne(paymentRequests.status, 'pending'), DECIDED_CAP),
    db
      .select({ status: paymentRequests.status, n: sql<string>`count(*)::text` })
      .from(paymentRequests)
      .groupBy(paymentRequests.status),
  ]);

  const counts: PaymentStatusCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    refunded: 0,
  };
  for (const c of countRows) {
    if (c.status in counts) counts[c.status as keyof PaymentStatusCounts] = Number(c.n);
  }

  const requests = await Promise.all([...pendingRaw, ...decidedRaw].map(toRow));
  return { requests, counts };
}

export default async function AdminPaymentsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('payments.review')) redirect('/admin');

  const { requests, counts } = await loadPaymentRequests();

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Membership payments"
        subtitle="Receipts members sent for eSewa, Khalti and bank transfers. Approving one gives them the membership they paid for."
        action={<DownloadCsv href="/api/admin/exports/payment-requests" />}
      />

      {/* One headline number, not four. The approved / rejected / refunded
          totals now ride on the filter buttons below, right next to the thing
          that switches to them, so the top of the page can answer the only
          question that needs answering on arrival: how much is waiting. */}
      <div style={{ maxWidth: 260, marginBottom: 24 }}>
        <StatTile
          label="Waiting for review"
          value={counts.pending.toLocaleString()}
          hint={counts.pending === 0 ? 'nothing waiting' : 'receipts to approve'}
        />
      </div>

      <PaymentsQueue
        requests={requests}
        counts={counts}
        canViewMembers={permissions.has('members.read')}
      />
    </div>
  );
}
