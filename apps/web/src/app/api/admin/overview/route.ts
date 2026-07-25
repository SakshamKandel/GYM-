import {
  accounts,
  auditLog,
  coachApplications,
  coachAssignments,
  coachMessages,
  coachProfiles,
  coachTierRequests,
  mealPaymentRequests,
  paymentRequests,
  planVideos,
} from '@gym/db';
import { effectiveTier, type Permission } from '@gym/shared';
import { and, count, countDistinct, desc, eq, inArray, sql } from 'drizzle-orm';
import { effectivePermissionSet, requireStaff } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { loadMonthlyRevenue } from '@/lib/overviewRevenue';

export const runtime = 'nodejs';

/**
 * Admin console — the overview dashboard as an API for the native staff console.
 *
 *  GET /api/admin/overview
 *    → { membership?: {...}, recentActivity?: [...], ops: {...} }
 *
 * This is the API TWIN of src/app/admin/_overview/data.ts — kept in lockstep by
 * hand (that module is a server-component helper; we reimplement the queries
 * here so the API has no server-component coupling). The ONE exception is the
 * money: both twins now call `loadMonthlyRevenue` from @/lib/overviewRevenue,
 * because the hand-kept copies had already drifted into reporting different
 * revenue for the same month (UTC month + approved-only here, Nepal month +
 * settled-minus-refunded there).
 *
 * Every section is permission-gated (A3): the membership snapshot needs
 * members.read, the activity feed needs audit.read, and each ops tile needs its
 * own permission (P0-6). A caller with none of them still gets a valid 200 with
 * `ops: {}` and no membership/activity — no member PII or audit rows ever leak
 * to a role that can't see them (previously any staff got the whole snapshot).
 * Guarded by requireStaff only; the per-section checks are the real boundary.
 *
 * Tier counts collapse a lapsed paid tier to 'starter' (D2) so paid figures
 * can't drift permanently upward.
 */

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
const TIER_ORDER: Tier[] = ['starter', 'silver', 'gold', 'elite'];

const effectiveTierSql = sql<Tier>`CASE
  WHEN ${accounts.tier} <> 'starter'
   AND ${accounts.tierExpiresAt} IS NOT NULL
   AND ${accounts.tierExpiresAt} <= now()
  THEN 'starter'
  ELSE ${accounts.tier}
END`;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;
  // Defense-in-depth (plan §1.4): a partner holds none of the per-section
  // permissions below, so it would already get a 200 with `ops:{}` and no
  // membership/activity — but the delivery-only role has no business on any
  // admin surface, so refuse it outright before any query runs.
  if (principal.role === 'partner') return json({ error: 'forbidden' }, 403);

  let permissions: ReadonlySet<Permission>;
  try {
    permissions = await effectivePermissionSet(principal);
  } catch (err) {
    console.error('overview permission resolution failed:', err);
    return json({ error: 'authorization_unavailable' }, 503);
  }
  const canMembers = permissions.has('members.read');
  const canAudit = permissions.has('audit.read');
  const canApplications = permissions.has('coach.application.review');
  const canPayments = permissions.has('payments.review');
  const canSupport = permissions.has('support.thread.read');

  const db = getDb();
  const now = new Date();

  const body: Record<string, unknown> = {};

  // --- Membership snapshot (members.read) -----------------------------------
  if (canMembers) {
    const [
      totalMembersRows,
      activeCoachesRows,
      activeAssignmentsRows,
      readyVideosRows,
      tierRows,
      signups,
    ] = await Promise.all([
      db.select({ n: count() }).from(accounts),
      db.select({ n: count() }).from(coachProfiles).where(eq(coachProfiles.isActive, true)),
      db
        .select({ n: count() })
        .from(coachAssignments)
        .where(eq(coachAssignments.status, 'active')),
      db.select({ n: count() }).from(planVideos).where(eq(planVideos.status, 'ready')),
      db
        .select({ tier: effectiveTierSql, n: count() })
        .from(accounts)
        .groupBy(effectiveTierSql),
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
    ]);

    const tierCounts = new Map<Tier, number>();
    for (const r of tierRows) tierCounts.set(r.tier as Tier, Number(r.n));
    const tierBreakdown = TIER_ORDER.map((tier) => ({ tier, count: tierCounts.get(tier) ?? 0 }));

    body.membership = {
      totalMembers: Number(totalMembersRows[0]?.n ?? 0),
      activeCoaches: Number(activeCoachesRows[0]?.n ?? 0),
      activeAssignments: Number(activeAssignmentsRows[0]?.n ?? 0),
      readyVideos: Number(readyVideosRows[0]?.n ?? 0),
      tierBreakdown,
      recentSignups: signups.map((s) => ({
        id: s.id,
        email: s.email,
        displayName: s.displayName,
        tier: effectiveTier(s.tier as Tier, s.tierExpiresAt, now),
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  // --- Activity feed (audit.read) -------------------------------------------
  if (canAudit) {
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

    body.recentActivity = activityRows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      actorEmail: r.actorId ? (actorEmailById.get(r.actorId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // --- Ops-queue tiles (per-permission, P0-6) -------------------------------
  const ops: Record<string, unknown> = {};

  if (canApplications) {
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

  if (canPayments) {
    const [pending, pendingMealPayments, revenue] = await Promise.all([
      db
        .select({ n: count() })
        .from(paymentRequests)
        .where(eq(paymentRequests.status, 'pending')),
      // Meal-order/subscription-cycle eSewa/Khalti receipts awaiting review —
      // the sibling queue to `paymentRequests` above (B25 blind-tile fix).
      db
        .select({ n: count() })
        .from(mealPaymentRequests)
        .where(eq(mealPaymentRequests.status, 'pending')),
      // Nepal-month, settled-minus-refunded — the ONE implementation, shared
      // with the server-rendered dashboard (admin/_overview/data.ts). Same
      // numbers, same month, whichever surface finance opens.
      loadMonthlyRevenue(now),
    ]);
    ops.pendingPayments = Number(pending[0]?.n ?? 0);
    ops.pendingMealPayments = Number(pendingMealPayments[0]?.n ?? 0);
    ops.revenueThisMonth = revenue;
  }

  if (canSupport) {
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

  body.ops = ops;

  return json(body, 200);
}
