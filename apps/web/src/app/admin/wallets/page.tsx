import { accounts, admins, coachProfiles, walletLedger } from '@gym/db';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import {
  type LedgerEntry,
  type WalletRow,
  WalletsManager,
} from './_components/WalletsManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to manage coach wallets. Mirrors the 'wallet.manage' grant in
 * authz.ts — super_admin + main_admin ONLY, per SCALE-UP-PLAN §4. The layout
 * hides the nav link for anyone else; we re-check here so the URL fails safe.
 */
const CAN_MANAGE: readonly StaffRole[] = ['super_admin', 'main_admin'];

const LEDGER_CAP = 500;

/** Every coach account, so a coach with zero ledger activity still lists. */
async function loadCoaches(): Promise<
  Array<{ id: string; email: string; displayName: string; coachTier: WalletRow['coachTier'] }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      accountName: accounts.displayName,
      profileName: coachProfiles.displayName,
      coachTier: coachProfiles.coachTier,
    })
    .from(admins)
    .innerJoin(accounts, eq(accounts.id, admins.accountId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(eq(admins.role, 'coach'))
    .orderBy(asc(accounts.displayName));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.profileName?.trim() || r.accountName?.trim() || '',
    coachTier: (r.coachTier ?? 'silver') as WalletRow['coachTier'],
  }));
}

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
 * All ledger rows (capped), grouped by coach, newest first — there is no
 * per-coach ledger-read endpoint in the pinned API surface (only the
 * balances-only GET /api/admin/wallets), so the drawer's history comes from
 * this direct read instead of a client fetch.
 */
async function loadLedger(): Promise<Record<string, LedgerEntry[]>> {
  const db = getDb();
  const rows = await db
    .select({
      id: walletLedger.id,
      coachId: walletLedger.coachId,
      type: walletLedger.type,
      amountMinor: walletLedger.amountMinor,
      currency: walletLedger.currency,
      note: walletLedger.note,
      createdAt: walletLedger.createdAt,
    })
    .from(walletLedger)
    .orderBy(desc(walletLedger.createdAt))
    .limit(LEDGER_CAP);

  const byCoach: Record<string, LedgerEntry[]> = {};
  for (const r of rows) {
    (byCoach[r.coachId] ??= []).push({
      id: r.id,
      type: r.type as LedgerEntry['type'],
      amountMinor: r.amountMinor,
      currency: r.currency,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    });
  }
  return byCoach;
}

export default async function AdminWalletsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  if (!CAN_MANAGE.includes(principal.role)) redirect('/admin');

  const [coaches, balances, ledgerByCoach] = await Promise.all([
    loadCoaches(),
    loadBalances(),
    loadLedger(),
  ]);

  const wallets: WalletRow[] = coaches.map((c) => ({
    coachId: c.id,
    displayName: c.displayName,
    email: c.email,
    coachTier: c.coachTier,
    balances: balances[c.id] ?? [],
  }));

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Coach wallets"
        subtitle="Commission balances from promo-coded purchases. Record manual adjustments or payouts here — payout rails are still manual."
      />

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

      <WalletsManager wallets={wallets} ledgerByCoach={ledgerByCoach} />
    </div>
  );
}
