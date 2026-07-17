import {
  coachAssignedWorkouts,
  coachAssignments,
  coachDietPlans,
  coachProfiles,
  coachRequests,
  coachTierRequests,
  walletLedger,
} from '@gym/db';
import { and, eq, sql } from 'drizzle-orm';
import type { getDb } from './db';

type Db = ReturnType<typeof getDb>;

/** Money still owed to (or clawed back from) a coach, per currency. */
export interface WalletBalance {
  currency: string;
  amountMinor: number;
}

/**
 * The blast radius of revoking a coach's role — surfaced BOTH as a pre-flight
 * dry-run (so the operator confirms with real numbers) and as the record of
 * what the cascade actually changed.
 */
export interface OffboardCounts {
  activeClients: number; // active assignments to be ended
  pendingRequests: number; // pending member requests to be declined
  pendingTierRequests: number; // pending coach tier-up requests to be rejected
  activeWorkoutPlans: number; // coach-assigned workouts to be archived
  activeDietPlans: number; // coach-assigned diet plans to be archived
  walletBalances: WalletBalance[]; // outstanding balance per currency (never touched)
}

/**
 * READ-ONLY dry-run: how many things would the cascade touch if this coach were
 * offboarded right now? Drives the typed-confirm UI (P0-3) on both consoles.
 * Wallet balances are reported so the operator can see money is outstanding, but
 * the cascade NEVER moves money — the ledger is preserved (C2/E10).
 */
export async function coachOffboardCounts(db: Db, coachId: string): Promise<OffboardCounts> {
  const [assignments, requests, tierRequests, workouts, diets, balances] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(coachAssignments)
      .where(and(eq(coachAssignments.coachId, coachId), eq(coachAssignments.status, 'active'))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(coachRequests)
      .where(and(eq(coachRequests.coachId, coachId), eq(coachRequests.status, 'pending'))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(coachTierRequests)
      .where(and(eq(coachTierRequests.coachId, coachId), eq(coachTierRequests.status, 'pending'))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(coachAssignedWorkouts)
      .where(
        and(eq(coachAssignedWorkouts.coachId, coachId), eq(coachAssignedWorkouts.status, 'active')),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(coachDietPlans)
      .where(and(eq(coachDietPlans.coachId, coachId), eq(coachDietPlans.status, 'active'))),
    db
      .select({
        currency: walletLedger.currency,
        // cast to text then Number() — a raw ::int sum overflows past ~21.4M
        // minor units.
        total: sql<string>`sum(${walletLedger.amountMinor})::text`,
      })
      .from(walletLedger)
      .where(eq(walletLedger.coachId, coachId))
      .groupBy(walletLedger.currency),
  ]);

  return {
    activeClients: Number(assignments[0]?.n ?? 0),
    pendingRequests: Number(requests[0]?.n ?? 0),
    pendingTierRequests: Number(tierRequests[0]?.n ?? 0),
    activeWorkoutPlans: Number(workouts[0]?.n ?? 0),
    activeDietPlans: Number(diets[0]?.n ?? 0),
    walletBalances: balances
      .map((b) => ({ currency: b.currency, amountMinor: Number(b.total ?? 0) }))
      .filter((b) => b.amountMinor !== 0),
  };
}

/**
 * Executes the offboarding cascade (C2) when a coach loses the coach role
 * (revoke, or a role change away from coach). Idempotent — every step is
 * scoped by an `active`/`pending` status filter, so re-running it after a
 * partial failure is a no-op on the already-transitioned rows:
 *
 *  - end every ACTIVE coach_assignments row (clients stop messaging a void),
 *  - decline every PENDING coach_requests row (they could never be decided),
 *  - reject every PENDING coach_tier_requests row (a tier-up approved after
 *    offboarding would upsert a tier for a coach who is no longer active),
 *  - flip coach_profiles.isActive → false (drops the coach from discovery),
 *  - archive every ACTIVE coach-assigned workout + diet plan.
 *
 * Money is deliberately NOT touched: wallet_ledger rows survive (restrict FK),
 * and the wallets roster is driven off wallet_ledger.coachId so a revoked coach
 * with a balance stays visible for payout (E10). Returns the affected counts +
 * the ended clients' ids for the audit meta.
 */
export async function offboardCoach(
  db: Db,
  coachId: string,
): Promise<OffboardCounts & { endedClientIds: string[] }> {
  const now = new Date();

  const endedAssignments = await db
    .update(coachAssignments)
    .set({ status: 'ended' })
    .where(and(eq(coachAssignments.coachId, coachId), eq(coachAssignments.status, 'active')))
    .returning({ userId: coachAssignments.userId });

  const declinedRequests = await db
    .update(coachRequests)
    .set({ status: 'declined', decidedAt: now })
    .where(and(eq(coachRequests.coachId, coachId), eq(coachRequests.status, 'pending')))
    .returning({ id: coachRequests.id });

  // Reject any pending tier-up request too — otherwise it survives the cascade
  // and stays approvable in the admin queue, upserting a coachTier (+ misleading
  // "tier upgraded" push) for an account that is no longer a coach.
  const rejectedTierRequests = await db
    .update(coachTierRequests)
    .set({ status: 'rejected', decidedAt: now })
    .where(and(eq(coachTierRequests.coachId, coachId), eq(coachTierRequests.status, 'pending')))
    .returning({ id: coachTierRequests.id });

  // isActive=false rather than deleting the profile — history + wallet stay.
  await db
    .update(coachProfiles)
    .set({ isActive: false })
    .where(eq(coachProfiles.accountId, coachId));

  const archivedWorkouts = await db
    .update(coachAssignedWorkouts)
    .set({ status: 'archived', updatedAt: now })
    .where(
      and(eq(coachAssignedWorkouts.coachId, coachId), eq(coachAssignedWorkouts.status, 'active')),
    )
    .returning({ id: coachAssignedWorkouts.id });

  const archivedDiets = await db
    .update(coachDietPlans)
    .set({ status: 'archived', updatedAt: now })
    .where(and(eq(coachDietPlans.coachId, coachId), eq(coachDietPlans.status, 'active')))
    .returning({ id: coachDietPlans.id });

  const balances = await db
    .select({
      currency: walletLedger.currency,
      total: sql<string>`sum(${walletLedger.amountMinor})::text`,
    })
    .from(walletLedger)
    .where(eq(walletLedger.coachId, coachId))
    .groupBy(walletLedger.currency);

  return {
    activeClients: endedAssignments.length,
    pendingRequests: declinedRequests.length,
    pendingTierRequests: rejectedTierRequests.length,
    activeWorkoutPlans: archivedWorkouts.length,
    activeDietPlans: archivedDiets.length,
    walletBalances: balances
      .map((b) => ({ currency: b.currency, amountMinor: Number(b.total ?? 0) }))
      .filter((b) => b.amountMinor !== 0),
    endedClientIds: endedAssignments.map((r) => r.userId),
  };
}
