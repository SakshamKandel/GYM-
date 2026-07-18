import {
  accounts,
  auditLog,
  coachApplications,
  coachAssignments,
  coachMessages,
  coachProfiles,
  coachTierRequests,
  paymentRequests,
  planVideos,
} from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, count, countDistinct, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

export interface RecentSignup {
  id: string;
  email: string;
  displayName: string;
  tier: Tier;
  status: 'active' | 'suspended';
  createdAt: Date;
}

export interface RecentActivity {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorEmail: string | null;
  createdAt: Date;
}

/** The membership snapshot — only ever computed for a members.read holder (A3). */
/** One calendar day's signup count (UTC calendar day, 'YYYY-MM-DD'). */
export interface SignupDayCount {
  date: string;
  count: number;
}

export interface MembershipSnapshot {
  totalMembers: number;
  activeCoaches: number;
  activeAssignments: number;
  readyVideos: number;
  tierBreakdown: { tier: Tier; count: number }[];
  recentSignups: RecentSignup[];
  /** Daily signup counts for the last 28 UTC calendar days (oldest first, zero-filled).
   * Purely a visualization aid — same underlying `accounts` rows already counted
   * in totalMembers/recentSignups, sliced by day. */
  dailySignups28: SignupDayCount[];
  /** Share of total coach capacity (sum of coach_profiles.capacity for active
   * coaches) currently used by active assignments, 0..1. Derived from the same
   * activeCoaches/activeAssignments figures already shown above. */
  coachCapacityPct: number;
}

/** Pending-work tiles (P0-6). Each field is null when the caller lacks its permission. */
export interface OpsQueue {
  pendingApplications: number | null; // coach.application.review
  pendingTierRequests: number | null; // coach.application.review
  pendingPayments: number | null; // payments.review
  revenueThisMonth: { currency: string; amountMinor: number }[] | null; // payments.review
  unreadSupport: number | null; // support.thread.read
}

/** What the caller is permitted to see on the overview — drives every section. */
export interface OverviewPerms {
  members: boolean; // members.read
  audit: boolean; // audit.read
  applications: boolean; // coach.application.review
  payments: boolean; // payments.review
  support: boolean; // support.thread.read
}

export interface OverviewData {
  membership: MembershipSnapshot | null; // null unless perms.members
  recentActivity: RecentActivity[] | null; // null unless perms.audit
  ops: OpsQueue;
}

/**
 * Effective-tier SQL: a paid tier whose window has lapsed collapses to
 * 'starter' (D2). Mirrors effectiveTier() in @gym/shared for the aggregate
 * GROUP BY so paid counts can't drift permanently upward off stale rows.
 */
const effectiveTierSql = sql<Tier>`CASE
  WHEN ${accounts.tier} <> 'starter'
   AND ${accounts.tierExpiresAt} IS NOT NULL
   AND ${accounts.tierExpiresAt} <= now()
  THEN 'starter'
  ELSE ${accounts.tier}
END`;

/**
 * Single read pass for the admin overview, SCOPED to what `perms` allows (A3):
 * the membership snapshot needs members.read, the activity feed needs
 * audit.read, and each ops tile needs its own permission. Nothing a caller may
 * not see is ever queried, let alone returned. Everything is a pure read via
 * getDb — no API route needed here.
 *
 * Kept in lockstep BY HAND with the API twin (api/admin/overview/route.ts).
 */
export async function loadOverview(perms: OverviewPerms): Promise<OverviewData> {
  const db = getDb();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const membership = perms.members ? await loadMembership(now) : null;
  const recentActivity = perms.audit ? await loadActivity() : null;

  const ops: OpsQueue = {
    pendingApplications: null,
    pendingTierRequests: null,
    pendingPayments: null,
    revenueThisMonth: null,
    unreadSupport: null,
  };

  if (perms.applications) {
    const [apps, tiers] = await Promise.all([
      db
        .select({ n: count() })
        .from(coachApplications)
        .where(eq(coachApplications.status, 'pending')),
      db
        .select({ n: count() })
        .from(coachTierRequests)
        .where(eq(coachTierRequests.status, 'pending')),
    ]);
    ops.pendingApplications = Number(apps[0]?.n ?? 0);
    ops.pendingTierRequests = Number(tiers[0]?.n ?? 0);
  }

  if (perms.payments) {
    const [pending, revenue] = await Promise.all([
      db
        .select({ n: count() })
        .from(paymentRequests)
        .where(eq(paymentRequests.status, 'pending')),
      db
        .select({
          currency: paymentRequests.currency,
          // cast to text then Number() — a raw ::int sum overflows past ~21.4M
          // minor units (E12).
          total: sql<string>`sum(${paymentRequests.amountMinor})::text`,
        })
        .from(paymentRequests)
        .where(
          and(
            eq(paymentRequests.status, 'approved'),
            gte(paymentRequests.decidedAt, monthStart),
          ),
        )
        .groupBy(paymentRequests.currency),
    ]);
    ops.pendingPayments = Number(pending[0]?.n ?? 0);
    ops.revenueThisMonth = revenue.map((r) => ({
      currency: r.currency,
      amountMinor: Number(r.total ?? 0),
    }));
  }

  if (perms.support) {
    const unread = await db
      .select({ n: countDistinct(coachMessages.accountId) })
      .from(coachMessages)
      .where(
        and(
          eq(coachMessages.kind, 'support'),
          eq(coachMessages.sender, 'user'),
          eq(coachMessages.readByCoach, false),
        ),
      );
    ops.unreadSupport = Number(unread[0]?.n ?? 0);
  }

  return { membership, recentActivity, ops };
}

/** Membership snapshot — only invoked for members.read holders. */
async function loadMembership(now: Date): Promise<MembershipSnapshot> {
  const db = getDb();
  const since28 = new Date(now);
  since28.setUTCDate(since28.getUTCDate() - 27);
  since28.setUTCHours(0, 0, 0, 0);

  const [
    totalMembersRows,
    activeCoachesRows,
    activeAssignmentsRows,
    readyVideosRows,
    tierRows,
    signups,
    capacityRows,
    dailyRows,
  ] = await Promise.all([
    db.select({ n: count() }).from(accounts),
    db.select({ n: count() }).from(coachProfiles).where(eq(coachProfiles.isActive, true)),
    db
      .select({ n: count() })
      .from(coachAssignments)
      .where(eq(coachAssignments.status, 'active')),
    db.select({ n: count() }).from(planVideos).where(eq(planVideos.status, 'ready')),
    // Group on the EFFECTIVE tier so lapsed paid rows fall back to starter (D2).
    db.select({ tier: effectiveTierSql, n: count() }).from(accounts).groupBy(effectiveTierSql),
    db
      .select({
        id: accounts.id,
        email: accounts.email,
        displayName: accounts.displayName,
        tier: accounts.tier,
        tierExpiresAt: accounts.tierExpiresAt,
        status: accounts.status,
        createdAt: accounts.createdAt,
      })
      .from(accounts)
      .orderBy(desc(accounts.createdAt))
      .limit(8),
    db
      .select({ total: sql<string>`coalesce(sum(${coachProfiles.capacity}), 0)::text` })
      .from(coachProfiles)
      .where(eq(coachProfiles.isActive, true)),
    // Daily signup counts for the trend chart + weekday heatmap — same
    // `accounts` rows already counted in totalMembers, just bucketed by day.
    db
      .select({ day: sql<string>`to_char(${accounts.createdAt}, 'YYYY-MM-DD')`, n: count() })
      .from(accounts)
      .where(gte(accounts.createdAt, since28))
      .groupBy(sql`to_char(${accounts.createdAt}, 'YYYY-MM-DD')`),
  ]);

  const tierCounts = new Map<Tier, number>();
  for (const r of tierRows) tierCounts.set(r.tier as Tier, Number(r.n));
  const tierBreakdown = TIER_ORDER.map((tier) => ({ tier, count: tierCounts.get(tier) ?? 0 }));

  const dailyByDate = new Map<string, number>();
  for (const r of dailyRows) dailyByDate.set(r.day, Number(r.n));
  const dailySignups28: SignupDayCount[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(since28);
    d.setUTCDate(d.getUTCDate() + (27 - i));
    const key = d.toISOString().slice(0, 10);
    dailySignups28.push({ date: key, count: dailyByDate.get(key) ?? 0 });
  }

  const totalCapacity = Number(capacityRows[0]?.total ?? 0);
  const activeAssignments = Number(activeAssignmentsRows[0]?.n ?? 0);
  const coachCapacityPct = totalCapacity > 0 ? activeAssignments / totalCapacity : 0;

  return {
    totalMembers: Number(totalMembersRows[0]?.n ?? 0),
    activeCoaches: Number(activeCoachesRows[0]?.n ?? 0),
    activeAssignments,
    readyVideos: Number(readyVideosRows[0]?.n ?? 0),
    tierBreakdown,
    recentSignups: signups.map((s) => ({
      id: s.id,
      email: s.email,
      displayName: s.displayName,
      // Render the EFFECTIVE tier so a lapsed member isn't shown as paid (D2).
      tier: effectiveTier(s.tier as Tier, s.tierExpiresAt, now) as Tier,
      status: s.status as 'active' | 'suspended',
      createdAt: s.createdAt,
    })),
    dailySignups28,
    coachCapacityPct,
  };
}

/** Recent audit feed — only invoked for audit.read holders (A3). */
async function loadActivity(): Promise<RecentActivity[]> {
  const db = getDb();
  const activityRows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      actorId: auditLog.actorId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(10);

  // Resolve actor emails in one round-trip (actorId may be null after the actor
  // account is deleted — audit_log SET NULLs it, so we skip those).
  const actorIds = Array.from(
    new Set(activityRows.map((r) => r.actorId).filter((v): v is string => Boolean(v))),
  );
  const actorEmailById = new Map<string, string>();
  if (actorIds.length > 0) {
    const actorRows = await db
      .select({ id: accounts.id, email: accounts.email })
      .from(accounts)
      .where(inArray(accounts.id, actorIds));
    for (const a of actorRows) actorEmailById.set(a.id, a.email);
  }

  return activityRows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    actorEmail: r.actorId ? (actorEmailById.get(r.actorId) ?? null) : null,
    createdAt: r.createdAt,
  }));
}
