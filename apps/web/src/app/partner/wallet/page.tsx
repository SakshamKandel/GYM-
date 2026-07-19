import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import {
  loadPartnerHeld,
  loadPartnerLedger,
  loadPartnerPayoutRequests,
  requirePartnerPage,
} from '../_data';
import { PartnerWalletView } from './_components/PartnerWalletView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Partner wallet (WP-5, Pack I) — the partner half of the earner payout rail.
 * Shows the WITHDRAWABLE held balance (which now decrements as payouts post —
 * B27), a request-payout form, the pending request state, and the wallet-ledger
 * history. Every figure is scoped to the caller's own restaurant via
 * `requirePartnerPage` (partnerId from the session, never a param).
 */
export default async function PartnerWalletPage() {
  const { partnerId, currency } = await requirePartnerPage();
  const db = getDb();

  const [held, ledger, requests] = await Promise.all([
    loadPartnerHeld(db, partnerId, currency),
    loadPartnerLedger(db, partnerId, 50),
    loadPartnerPayoutRequests(db, partnerId, 25),
  ]);

  const pending = requests.find((r) => r.status === 'pending') ?? null;

  return (
    <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Wallet"
        subtitle="Digital revenue the platform holds for you, and your payout requests."
      />
      <PartnerWalletView
        currency={currency}
        heldMinor={held.heldMinor}
        earnedMinor={held.earnedMinor}
        paidOutMinor={held.paidOutMinor}
        ledger={ledger}
        requests={requests}
        initialPending={pending}
      />
    </div>
  );
}
