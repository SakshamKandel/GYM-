import { accounts, admins, coachProfiles, walletLedger } from '@gym/db';
import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { DownloadCsv } from '../_components/DownloadCsv';
import { type WalletRow, WalletsManager } from './_components/WalletsManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to manage coach wallets. Mirrors the 'wallet.manage' grant in
 * authz.ts — super_admin + main_admin ONLY, per SCALE-UP-PLAN §4. The layout
 * hides the nav link for anyone else; we re-check here so the URL fails safe.
 */

/** SUM(amountMinor) per (coach, currency) — balance has no materialized column. */
async function loadBalances(): Promise<Record<string, { currency: string; amountMinor: number }[]>> {
  const db = getDb();
  const rows = await db
    .select({
      coachId: walletLedger.coachId,
      currency: walletLedger.currency,
      total: sql<string>`sum(${walletLedger.amountMinor})`,
    })
    .from(walletLedger)
    .groupBy(walletLedger.coachId, walletLedger.currency);

  const byCoach: Record<string, { currency: string; amountMinor: number }[]> = {};
  for (const r of rows) {
    (byCoach[r.coachId] ??= []).push({
      currency: r.currency,
      amountMinor: Number(r.total),
    });
  }
  return byCoach;
}

/**
 * Every coach account (so a coach with zero ledger activity still lists) PLUS
 * any account that still holds a ledger balance but is no longer role='coach'
 * (E10 / C2 offboarding cascade) — a revoked coach's unpaid balance must stay
 * visible and trackable. `ledgerCoachIds` are the accounts appearing in
 * wallet_ledger; the roster unions them with current coaches.
 */
async function loadCoaches(
  ledgerCoachIds: string[],
): Promise<Array<{ id: string; email: string; displayName: string; coachTier: WalletRow['coachTier']; revoked: boolean }>> {
  const db = getDb();
  const rosterFilter =
    ledgerCoachIds.length > 0
      ? or(eq(admins.role, 'coach'), inArray(accounts.id, ledgerCoachIds))
      : eq(admins.role, 'coach');

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      accountName: accounts.displayName,
      role: admins.role,
      profileName: coachProfiles.displayName,
      coachTier: coachProfiles.coachTier,
    })
    .from(accounts)
    .leftJoin(admins, eq(admins.accountId, accounts.id))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(rosterFilter)
    .orderBy(asc(accounts.displayName));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.profileName?.trim() || r.accountName?.trim() || '',
    coachTier: (r.coachTier ?? 'silver') as WalletRow['coachTier'],
    revoked: r.role !== 'coach',
  }));
}

export default async function AdminWalletsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  // C-C: this surface is reachable by wallet.manage (balances + record entry)
  // OR payouts.review (the payout-request queue). Gating on wallet.manage alone
  // stranded a scoped payouts.review grantee out of the queue entirely (P1-5).
  const canManageWallets = permissions.has('wallet.manage');
  const canReviewPayouts = permissions.has('payouts.review');
  if (!canManageWallets && !canReviewPayouts) redirect('/admin');

  // Balance/roster data (and its ledger CSV) is wallet.manage territory; a
  // payouts-only reviewer never sees it — the queue carries its own coach names
  // and balances.
  const wallets: WalletRow[] = canManageWallets
    ? await (async () => {
        const balances = await loadBalances();
        const coaches = await loadCoaches(Object.keys(balances));
        return coaches.map((c) => ({
          coachId: c.id,
          displayName: c.displayName,
          email: c.email,
          coachTier: c.coachTier,
          revoked: c.revoked,
          balances: balances[c.id] ?? [],
        }));
      })()
    : [];

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Coach wallets"
        subtitle="Commission balances from promo-coded purchases. Record manual adjustments or payouts here — payout rails are still manual."
        action={
          canManageWallets ? (
            <DownloadCsv href="/api/admin/exports/wallet-ledger" label="Download ledger CSV" />
          ) : undefined
        }
      />

      {canManageWallets ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <StatTile label="Coaches" value={wallets.length} />
          <StatTile
            label="With balance"
            value={wallets.filter((w) => w.balances.length > 0).length}
          />
        </div>
      ) : null}

      <WalletsManager
        wallets={wallets}
        canManageWallets={canManageWallets}
        canReviewPayouts={canReviewPayouts}
      />
    </div>
  );
}
