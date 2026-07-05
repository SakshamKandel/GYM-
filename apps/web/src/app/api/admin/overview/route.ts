import {
  accounts,
  auditLog,
  coachAssignments,
  coachProfiles,
  planVideos,
} from '@gym/db';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — the overview dashboard as an API for the native staff console.
 *
 *  GET /api/admin/overview
 *    → { totalMembers, activeCoaches, activeAssignments, readyVideos,
 *        tierBreakdown: [{ tier, count }], recentSignups: RecentSignup[<=8],
 *        recentActivity: RecentActivity[<=10] }
 *
 * This mirrors the read logic in src/app/admin/_overview/data.ts. That module is
 * a server component helper (loadOverview); we deliberately reimplement the
 * queries here rather than import it, so the API has no server-component
 * coupling. Kept in lockstep with data.ts by hand.
 *
 *  - totalMembers      → count of ALL accounts (the platform user base).
 *  - activeCoaches     → coach_profiles where isActive (source of truth for a
 *                        live coach identity).
 *  - activeAssignments → coach_assignments where status = 'active'.
 *  - readyVideos       → plan_videos where status = 'ready'.
 *  - tierBreakdown     → one entry per tier in fixed order, zero-filled.
 *  - recentSignups     → newest 8 accounts.
 *  - recentActivity    → newest 10 audit_log rows, actor emails resolved in one
 *                        round-trip (actorId is SET NULL after actor deletion,
 *                        so those rows carry actorEmail: null).
 *
 * Guarded by requirePermission('members.read') — super_admin, main_admin,
 * member_admin and support_admin hold it per the role matrix.
 */

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'members.read');
  if (principal instanceof Response) return principal;

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

  // Resolve actor emails in one round-trip (actorId may be null once the actor
  // account is deleted — audit_log SET NULLs it, so we skip those).
  const actorIds = Array.from(
    new Set(
      activityRows.map((r) => r.actorId).filter((v): v is string => Boolean(v)),
    ),
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

  return json(
    {
      totalMembers: Number(totalMembersRows[0]?.n ?? 0),
      activeCoaches: Number(activeCoachesRows[0]?.n ?? 0),
      activeAssignments: Number(activeAssignmentsRows[0]?.n ?? 0),
      readyVideos: Number(readyVideosRows[0]?.n ?? 0),
      tierBreakdown,
      recentSignups: signups.map((s) => ({
        id: s.id,
        email: s.email,
        displayName: s.displayName,
        tier: s.tier,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
      recentActivity: activityRows.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        actorEmail: r.actorId
          ? (actorEmailById.get(r.actorId) ?? null)
          : null,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    200,
  );
}
