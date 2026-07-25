import {
  accounts,
  auditLog,
  checkIns,
  gamificationProfiles,
  memberWeightLogs,
  syncedWorkouts,
} from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { adminRoleOf } from './authz';
import { getDb } from './db';

/**
 * Curated, read-only member snapshot — shared by
 * `GET /api/admin/members-view/[id]` and `admin/members/[id]/view/page.tsx`
 * (P2-19, "read-only member impersonation view"). Deliberately NOT the raw
 * `account_profiles.data` JSON blob (free-form onboarding answers/health
 * data) — this is a curated subset: identity basics, tier-change history
 * (from the audit log, not a separate ledger), workout counts, the
 * cached streak/rank numbers, and the latest bodyweight. Any staffer viewing
 * this is meant to get "what would this member see", not "everything we know
 * about this member".
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
  /** See `latestBodyweight` — check-in first, member weight log as fallback. */
  body?: {
    latestBodyweightKg: number | null;
    /** ISO yyyy-mm-dd of whichever source supplied the weight above. */
    latestBodyweightDate: string | null;
    latestBodyweightSource: BodyweightSource | null;
  };
}

/**
 * Which record supplied the latest bodyweight. 'check_in' is the weekly
 * check-in a coach reviews (verified, sparse); 'weight_log' is the member's own
 * synced scale history (member_weight_logs, daily, self-reported).
 */
export type BodyweightSource = 'check_in' | 'weight_log';

export interface LatestBodyweight {
  kg: number;
  date: string;
  source: BodyweightSource;
}

/**
 * The member's most recent bodyweight.
 *
 * The check-in value stays PRIMARY: it is the number a coach has seen and
 * reasoned about on the weekly review, so it must never be overwritten by a
 * self-reported scale entry. But check-ins are weekly at best and optional, and
 * a member who only uses the Body tab has none at all — which is why this used
 * to render blank. The member's own synced weight log (member_weight_logs,
 * tombstones excluded) is therefore a FALLBACK, used only when no check-in
 * carries a bodyweight. The returned `date` always belongs to whichever source
 * won, so the value and its timestamp can never disagree.
 */
export async function latestBodyweight(accountId: string): Promise<LatestBodyweight | null> {
  const db = getDb();

  const [checkInRows, logRows] = await Promise.all([
    db
      .select({ date: checkIns.date, bodyweightKg: checkIns.bodyweightKg })
      .from(checkIns)
      .where(and(eq(checkIns.accountId, accountId), isNotNull(checkIns.bodyweightKg)))
      .orderBy(desc(checkIns.date))
      .limit(1),
    db
      .select({ date: memberWeightLogs.date, kg: memberWeightLogs.kg })
      .from(memberWeightLogs)
      .where(and(eq(memberWeightLogs.accountId, accountId), eq(memberWeightLogs.deleted, false)))
      .orderBy(desc(memberWeightLogs.date))
      .limit(1),
  ]);

  const checkIn = checkInRows[0];
  if (checkIn && checkIn.bodyweightKg !== null) {
    return { kg: checkIn.bodyweightKg, date: checkIn.date, source: 'check_in' };
  }

  const log = logRows[0];
  if (log) return { kg: log.kg, date: log.date, source: 'weight_log' };

  return null;
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

  const [staffRole, historyRows, workoutCountRows, gamificationRows, bodyweight] = await Promise.all([
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
    latestBodyweight(accountId),
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
    body: {
      latestBodyweightKg: bodyweight?.kg ?? null,
      latestBodyweightDate: bodyweight?.date ?? null,
      latestBodyweightSource: bodyweight?.source ?? null,
    },
  };
}
