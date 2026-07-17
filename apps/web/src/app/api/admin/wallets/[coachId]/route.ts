import { accounts, coachProfiles, walletLedger } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { coachWalletBalances } from '@/lib/promoEconomy';

export const runtime = 'nodejs';

/**
 * Admin console — one coach's wallet detail (SCALE-UP-PLAN §4.1, contract
 * §4.8). The wallets roster GET /api/admin/wallets returns balances only; the
 * drawer / mobile wallet screen loads THIS endpoint on open so the ledger is
 * scoped to the selected coach (E9) instead of slicing a global newest-N feed
 * that leaves older coaches showing a nonzero balance with "No entries yet".
 *
 *  - GET → { coach: {id, displayName, coachTier}, balances: [{currency,
 *    amountMinor}], entries: [...] (newest ≤100) }.
 *
 * The coach is resolved off any account that has wallet_ledger activity OR is
 * currently role='coach' — a coach whose role was later revoked still has a
 * real balance to reconcile (E10 / C2 cascade), so this must not 404 on them.
 *
 * Guarded by requirePermission('wallet.manage'); super_admin/main_admin pass.
 */

const ENTRY_CAP = 100;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ coachId: string }> }) {
  const principal = await requirePermission(req, 'wallet.manage');
  if (principal instanceof Response) return principal;

  const { coachId } = await params;
  const db = getDb();

  const [account] = await db
    .select({
      id: accounts.id,
      accountName: accounts.displayName,
      profileName: coachProfiles.displayName,
      coachTier: coachProfiles.coachTier,
    })
    .from(accounts)
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(eq(accounts.id, coachId))
    .limit(1);
  if (!account) return json({ error: 'coach_not_found' }, 404);

  const [balances, entryRows] = await Promise.all([
    coachWalletBalances(coachId),
    db
      .select({
        id: walletLedger.id,
        type: walletLedger.type,
        amountMinor: walletLedger.amountMinor,
        currency: walletLedger.currency,
        note: walletLedger.note,
        createdAt: walletLedger.createdAt,
      })
      .from(walletLedger)
      .where(eq(walletLedger.coachId, coachId))
      .orderBy(desc(walletLedger.createdAt))
      .limit(ENTRY_CAP),
  ]);

  const entries = entryRows.map((e) => ({
    id: e.id,
    type: e.type,
    amountMinor: e.amountMinor,
    currency: e.currency,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  }));

  return json(
    {
      coach: {
        id: account.id,
        displayName: account.profileName?.trim() ? account.profileName : account.accountName,
        coachTier: account.coachTier ?? 'silver',
      },
      balances,
      entries,
    },
    200,
  );
}
