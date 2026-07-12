import { accounts, admins, coachProfiles } from '@gym/db';
import { eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { allCoachWalletBalances, type CoachBalance } from '@/lib/promoEconomy';

export const runtime = 'nodejs';

/**
 * Admin console — every coach's wallet balance (SCALE-UP-PLAN §4.1 / §5.4).
 *
 *  - GET → one row per `admins.role='coach'` account, each with its
 *    per-currency balances. Balances come from ONE grouped query across every
 *    coach (allCoachWalletBalances) joined in-memory against the roster —
 *    not a per-coach query, so this stays O(1) round-trips regardless of
 *    coach count. `displayName` prefers the public coach_profiles name,
 *    falling back to the account's own display name when the coach has never
 *    saved a profile row; `coachTier` defaults to 'silver' (the schema
 *    default) for the same reason.
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

  const [roster, balanceRows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        accountName: accounts.displayName,
        profileName: coachProfiles.displayName,
        coachTier: coachProfiles.coachTier,
      })
      .from(admins)
      .innerJoin(accounts, eq(admins.accountId, accounts.id))
      .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
      .where(eq(admins.role, 'coach'))
      .orderBy(accounts.displayName),
    allCoachWalletBalances(),
  ]);

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
    },
    balances: balancesByCoach.get(r.id) ?? [],
  }));

  return json({ wallets }, 200);
}
