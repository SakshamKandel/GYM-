import { accounts, paymentRequests } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { getVideoProvider } from '@/lib/video';
import {
  type PaymentRequestRow,
  PaymentsQueue,
} from './_components/PaymentsQueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to review manual payment requests. Mirrors the
 * 'payments.review' grant in authz.ts (super_admin + main_admin +
 * member_admin). The admin layout hides the nav link and guards the subtree,
 * but we re-check here so hitting the URL directly still fails safe.
 */
const CAN_REVIEW: readonly StaffRole[] = ['super_admin', 'main_admin', 'member_admin'];

const CAP = 200;

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

async function loadPaymentRequests(): Promise<PaymentRequestRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: paymentRequests.id,
      accountId: paymentRequests.accountId,
      accountEmail: accounts.email,
      accountDisplayName: accounts.displayName,
      tier: paymentRequests.tier,
      months: paymentRequests.months,
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
    .orderBy(desc(paymentRequests.createdAt))
    .limit(CAP);

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      accountId: r.accountId,
      accountEmail: r.accountEmail,
      accountDisplayName: r.accountDisplayName,
      tier: r.tier as PaymentRequestRow['tier'],
      months: r.months,
      amountMinor: r.amountMinor,
      currency: r.currency,
      method: r.method as PaymentRequestRow['method'],
      receiptUrl: r.receiptUid ? await resolveReceiptUrl(r.receiptUid) : null,
      note: r.note,
      status: r.status as PaymentRequestRow['status'],
      reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    })),
  );
}

export default async function AdminPaymentsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  if (!CAN_REVIEW.includes(principal.role)) redirect('/admin');

  const requests = await loadPaymentRequests();
  const pending = requests.filter((r) => r.status === 'pending').length;
  const approved = requests.filter((r) => r.status === 'approved').length;

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Payments"
        subtitle="Manual eSewa, Khalti, and bank-transfer payments awaiting review. Approving grants the tier for the paid window."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Total" value={requests.length} />
        <StatTile label="Pending" value={pending} />
        <StatTile label="Approved" value={approved} />
      </div>

      <PaymentsQueue requests={requests} />
    </div>
  );
}
