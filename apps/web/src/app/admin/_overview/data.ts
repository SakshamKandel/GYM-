import {
  accounts,
  admins,
  auditLog,
  coachAssignments,
  coachProfiles,
  planVideos,
} from '@gym/db';
import { count, desc, eq, inArray } from 'drizzle-orm';
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

export interface OverviewData {
  totalMembers: number;
  activeCoaches: number;
  activeAssignments: number;
  readyVideos: number;
  tierBreakdown: { tier: Tier; count: number }[];
  recentSignups: RecentSignup[];
  recentActivity: RecentActivity[];
}

/**
 * Single read pass for the admin overview. Everything is a pure read via
 * getDb — no API route needed. `totalMembers` counts every account (staff rows
 * are a superset keyed on accounts.id, but "members" here means all accounts —
 * the platform's user base). Coaches are counted from coach_profiles where
 * isActive, which is the source of truth for a live coach identity.
 */
export async function loadOverview(): Promise<OverviewData> {
  const db = getDb();

  const [
    totalMembersRows,
    activeCoachesRows,
    activeAssignmentsRows,
    readyVideosRows,
    tierRows,
    signups,
    activityRows,
  ] = await Promise.all([
    db.select({ n: count() }).from(accounts),
    db
      .select({ n: count() })
      .from(coachProfiles)
      .where(eq(coachProfiles.isActive, true)),
    db
      .select({ n: count() })
      .from(coachAssignments)
      .where(eq(coachAssignments.status, 'active')),
    db
      .select({ n: count() })
      .from(planVideos)
      .where(eq(planVideos.status, 'ready')),
    db
      .select({ tier: accounts.tier, n: count() })
      .from(accounts)
      .groupBy(accounts.tier),
    db
      .select({
        id: accounts.id,
        email: accounts.email,
        displayName: accounts.displayName,
        tier: accounts.tier,
        status: accounts.status,
        createdAt: accounts.createdAt,
      })
      .from(accounts)
      .orderBy(desc(accounts.createdAt))
      .limit(8),
    db
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
      .limit(10),
  ]);

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

  const tierCounts = new Map<Tier, number>();
  for (const r of tierRows) tierCounts.set(r.tier as Tier, Number(r.n));
  const tierBreakdown = TIER_ORDER.map((tier) => ({
    tier,
    count: tierCounts.get(tier) ?? 0,
  }));

  return {
    totalMembers: Number(totalMembersRows[0]?.n ?? 0),
    activeCoaches: Number(activeCoachesRows[0]?.n ?? 0),
    activeAssignments: Number(activeAssignmentsRows[0]?.n ?? 0),
    readyVideos: Number(readyVideosRows[0]?.n ?? 0),
    tierBreakdown,
    recentSignups: signups.map((s) => ({
      id: s.id,
      email: s.email,
      displayName: s.displayName,
      tier: s.tier as Tier,
      status: s.status as 'active' | 'suspended',
      createdAt: s.createdAt,
    })),
    recentActivity: activityRows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      actorEmail: r.actorId ? (actorEmailById.get(r.actorId) ?? null) : null,
      createdAt: r.createdAt,
    })),
  };
}
