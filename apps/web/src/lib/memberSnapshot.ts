import { accounts, auditLog, gamificationProfiles, syncedWorkouts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { adminRoleOf } from './authz';
import { getDb } from './db';

/**
 * Curated, read-only member snapshot — shared by
 * `GET /api/admin/members-view/[id]` and `admin/members/[id]/view/page.tsx`
 * (P2-19, "read-only member impersonation view"). Deliberately NOT the raw
 * `account_profiles.data` JSON blob (free-form onboarding answers/health
 * data) — this is a curated subset: identity basics, tier-change history
 * (from the audit log, not a separate ledger), workout counts, and the
 * cached streak/rank numbers. Any staffer viewing this is meant to get "what
 * would this member see", not "everything we know about this member".
 *
 * Kept out of `@/lib/authz` (which owns permission plumbing, not
 * query-shaping) and out of the members drawer's own query file (WP5 owns
 * `api/admin/members/[id]/route.ts` — a different curated projection for a
 * different surface) so the two curated views can evolve independently
 * without either package touching the other's files.
 */

/** Audit actions that represent a change to the member's tier or account status. */
const TIER_HISTORY_ACTIONS = [
  'subscription.override',
  'account.suspend',
  'account.reactivate',
  'payment.refund',
  'payment.approve',
  'coach.tier_grant',
] as const;

export interface MemberSnapshot {
  found: boolean;
  profile?: {
    id: string;
    email: string;
    displayName: string;
    tier: string;
    effectiveTier: string;
    tierExpiresAt: string | null;
    status: string;
    country: string | null;
    createdAt: string;
    staffRole: string | null;
  };
  tierHistory?: {
    id: string;
    action: string;
    actorId: string | null;
    meta: Record<string, unknown>;
    createdAt: string;
  }[];
  activity?: {
    workoutCount: number;
    streakWeeks: number;
    bestStreakWeeks: number;
    xpTotal: number;
  };
}

export async function loadMemberSnapshot(accountId: string): Promise<MemberSnapshot> {
  const db = getDb();

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
      country: accounts.country,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  const account = rows[0];
  if (!account) return { found: false };

  const [staffRole, historyRows, workoutCountRows, gamificationRows] = await Promise.all([
    adminRoleOf(accountId),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorId: auditLog.actorId,
        meta: auditLog.meta,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(eq(auditLog.targetType, 'account'), eq(auditLog.targetId, accountId), inArray(auditLog.action, [...TIER_HISTORY_ACTIONS])),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(20),
    db.select({ n: count() }).from(syncedWorkouts).where(eq(syncedWorkouts.accountId, accountId)),
    db
      .select({
        streakWeeks: gamificationProfiles.streakWeeks,
        bestStreakWeeks: gamificationProfiles.bestStreakWeeks,
        xpTotal: gamificationProfiles.xpTotal,
      })
      .from(gamificationProfiles)
      .where(eq(gamificationProfiles.accountId, accountId))
      .limit(1),
  ]);

  const gp = gamificationRows[0];

  return {
    found: true,
    profile: {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      tier: account.tier,
      effectiveTier: effectiveTier(account.tier, account.tierExpiresAt, new Date()),
      tierExpiresAt: account.tierExpiresAt ? account.tierExpiresAt.toISOString() : null,
      status: account.status,
      country: account.country,
      createdAt: account.createdAt.toISOString(),
      staffRole,
    },
    tierHistory: historyRows.map((h) => ({
      id: h.id,
      action: h.action,
      actorId: h.actorId,
      meta: h.meta,
      createdAt: h.createdAt.toISOString(),
    })),
    activity: {
      workoutCount: Number(workoutCountRows[0]?.n ?? 0),
      streakWeeks: gp?.streakWeeks ?? 0,
      bestStreakWeeks: gp?.bestStreakWeeks ?? 0,
      xpTotal: gp?.xpTotal ?? 0,
    },
  };
}
