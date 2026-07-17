import { accounts, admins, coachProfiles } from '@gym/db';
import { eq, inArray, or } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { allCoachWalletBalances, type CoachBalance } from '@/lib/promoEconomy';

export const runtime = 'nodejs';

/**
 * Admin console — every coach's wallet balance (SCALE-UP-PLAN §4.1 / §5.4).
 *
 *  - GET → one row per current `admins.role='coach'` account PLUS any account
 *    that has wallet_ledger activity but is no longer role='coach' (E10 / C2
 *    offboarding cascade) — a revoked coach can still hold an unpaid balance,
 *    so filtering the roster on role alone would make that money untrackable.
 *    Balances come from ONE grouped query across every coach
 *    (allCoachWalletBalances) joined in-memory against the roster — not a
 *    per-coach query, so this stays O(1) round-trips regardless of coach
 *    count. `displayName` prefers the public coach_profiles name, falling back
 *    to the account's own display name when the coach has never saved a
 *    profile row; `coachTier` defaults to 'silver' (the schema default).
 *
 * Guarded by requirePermission('wallet.manage'); super_admin/main_admin pass.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'wallet.manage');
  if (principal instanceof Response) return principal;

  const db = getDb();

  const balanceRows = await allCoachWalletBalances();
  const ledgerCoachIds = [...new Set(balanceRows.map((b) => b.coachId))];

  // Roster = current coaches ∪ any account still carrying a ledger balance
  // (revoked coaches must remain visible so their money stays trackable, E10).
  const rosterFilter =
    ledgerCoachIds.length > 0
      ? or(eq(admins.role, 'coach'), inArray(accounts.id, ledgerCoachIds))
      : eq(admins.role, 'coach');

  const roster = await db
    .select({
      id: accounts.id,
      accountName: accounts.displayName,
      role: admins.role,
      profileName: coachProfiles.displayName,
      coachTier: coachProfiles.coachTier,
    })
    .from(accounts)
    .leftJoin(admins, eq(admins.accountId, accounts.id))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(rosterFilter)
    .orderBy(accounts.displayName);

  const balancesByCoach = new Map<string, CoachBalance[]>();
  for (const b of balanceRows) {
    const list = balancesByCoach.get(b.coachId) ?? [];
    list.push({ currency: b.currency, amountMinor: b.amountMinor });
    balancesByCoach.set(b.coachId, list);
  }

  const wallets = roster.map((r) => ({
    coach: {
      id: r.id,
      displayName: r.profileName?.trim() ? r.profileName : r.accountName,
      coachTier: r.coachTier ?? 'silver',
      // A row surfaced only because it still holds a balance, not because it is
      // an active coach, is flagged so the UI can mark it "revoked".
      revoked: r.role !== 'coach',
    },
    balances: balancesByCoach.get(r.id) ?? [],
  }));

  return json({ wallets }, 200);
}
