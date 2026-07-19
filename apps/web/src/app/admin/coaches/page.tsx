import {
  accounts,
  admins,
  coachAssignments,
  coachProfiles,
  coachTierRequests,
} from '@gym/db';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { CoachRequestsOversight } from './_components/CoachRequestsOversight';
import {
  type ClientAssignment,
  type CoachSummary,
  type TierRequest,
  CoachRoster,
} from './_components/CoachRoster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to manage coach assignments. Mirrors canSeeCoaches() in
 * admin/layout.tsx and the 'coach.assign' grant in authz.ts (super_admin +
 * member_admin). The layout already hides the nav link and guards the subtree,
 * but we re-check here server-side so hitting the URL directly still fails safe
 * — the layout comment explicitly requires each page to re-check its role set.
 */

/**
 * Loads the coach roster directly via getDb — shape matches GET
 * /api/admin/coaches (name, active client count, profile flags) so the initial
 * server render and any later client refetch agree. LEFT JOIN to coach_profiles
 * so a coach with no profile row still appears (flags null) instead of being
 * dropped by an inner join. activeClients is a correlated count of
 * status='active' assignments.
 */
async function loadCoaches(): Promise<CoachSummary[]> {
  const db = getDb();
  const activeClients = sql<number>`(
    select count(*) from ${coachAssignments}
    where ${coachAssignments.coachId} = ${accounts.id}
      and ${coachAssignments.status} = 'active'
  )`;

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      coachName: coachProfiles.displayName,
      acceptingClients: coachProfiles.acceptingClients,
      isActive: coachProfiles.isActive,
      coachTier: coachProfiles.coachTier,
      capacity: coachProfiles.capacity,
      activeClients,
    })
    .from(admins)
    .innerJoin(accounts, eq(accounts.id, admins.accountId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(eq(admins.role, 'coach'))
    .orderBy(asc(accounts.displayName));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    coachName: r.coachName ?? null,
    acceptingClients: r.acceptingClients ?? null,
    isActive: r.isActive ?? null,
    coachTier: (r.coachTier ?? 'silver') as CoachSummary['coachTier'],
    capacity: r.capacity ?? 50,
    activeClients: Number(r.activeClients ?? 0),
  }));
}

/**
 * Loads every PENDING coach_tier_requests row, grouped by coach — mirrors
 * loadActiveClients below: one query, grouped client-side, so the roster can
 * render each coach's pending request(s) without a per-coach round trip.
 */
async function loadPendingTierRequests(): Promise<Record<string, TierRequest[]>> {
  const db = getDb();
  const rows = await db
    .select({
      id: coachTierRequests.id,
      coachId: coachTierRequests.coachId,
      requestedTier: coachTierRequests.requestedTier,
      note: coachTierRequests.note,
      createdAt: coachTierRequests.createdAt,
    })
    .from(coachTierRequests)
    .where(eq(coachTierRequests.status, 'pending'))
    .orderBy(desc(coachTierRequests.createdAt));

  const byCoach: Record<string, TierRequest[]> = {};
  for (const r of rows) {
    (byCoach[r.coachId] ??= []).push({
      id: r.id,
      requestedTier: r.requestedTier as TierRequest['requestedTier'],
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    });
  }
  return byCoach;
}

/**
 * Loads every ACTIVE assignment (client + coach it belongs to) in one query,
 * so the roster can render each coach's client list without a per-coach round
 * trip. Grouped into a map<coachId, clients[]> for the client component. Joins
 * accounts to surface the client's name/email/tier alongside the assignment id
 * (the id is what DELETE /api/admin/assignments/[id] needs to end it).
 */
async function loadActiveClients(): Promise<Record<string, ClientAssignment[]>> {
  const db = getDb();
  const rows = await db
    .select({
      assignmentId: coachAssignments.id,
      coachId: coachAssignments.coachId,
      userId: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      assignedAt: coachAssignments.createdAt,
    })
    .from(coachAssignments)
    .innerJoin(accounts, eq(accounts.id, coachAssignments.userId))
    .where(eq(coachAssignments.status, 'active'))
    .orderBy(asc(accounts.displayName));

  const byCoach: Record<string, ClientAssignment[]> = {};
  for (const r of rows) {
    (byCoach[r.coachId] ??= []).push({
      assignmentId: r.assignmentId,
      userId: r.userId,
      email: r.email,
      displayName: r.displayName,
      tier: r.tier,
      assignedAt:
        r.assignedAt instanceof Date
          ? r.assignedAt.toISOString()
          : r.assignedAt
            ? String(r.assignedAt)
            : null,
    });
  }
  return byCoach;
}

export default async function AdminCoachesPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  const canAssign = permissions.has('coach.assign');
  if (!canAssign) redirect('/admin');
  // Editing a coach's profile and deciding tier requests hit routes guarded by
  // `coach.application.review` — a DIFFERENT permission from `coach.assign`.
  // Deriving it here (rather than reusing canAssign) is what kills the 403-trap:
  // an operator with only `coach.assign` no longer sees an Edit panel / tier
  // Approve+Reject buttons that the API would reject (P1-1).
  const canReview = permissions.has('coach.application.review');
  const canModerate = permissions.has('moderation.manage');

  const [coaches, clientsByCoach, tierRequestsByCoach] = await Promise.all([
    loadCoaches(),
    loadActiveClients(),
    loadPendingTierRequests(),
  ]);

  // Console-wide summary numbers for the stat row.
  const totalCoaches = coaches.length;
  const accepting = coaches.filter((c) => c.acceptingClients === true).length;
  const assignedClients = coaches.reduce((n, c) => n + c.activeClients, 0);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Coaches"
        subtitle="Assign members to coaches and manage each coach's active client roster."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Coaches" value={totalCoaches} />
        <StatTile
          label="Accepting clients"
          value={accepting}
          hint={
            totalCoaches > 0
              ? `of ${totalCoaches}`
              : undefined
          }
        />
        <StatTile label="Assigned clients" value={assignedClients} />
      </div>

      <CoachRoster
        coaches={coaches}
        clientsByCoach={clientsByCoach}
        tierRequestsByCoach={tierRequestsByCoach}
        canAssign={canAssign}
        canReview={canReview}
      />

      {canModerate ? <CoachRequestsOversight /> : null}
    </div>
  );
}
