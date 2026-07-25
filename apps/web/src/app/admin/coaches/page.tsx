import {
  accounts,
  admins,
  coachAssignments,
  coachProfiles,
  coachTierRequests,
} from '@gym/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
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
export const metadata: Metadata = { title: 'Coaches' };
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
 * one query, grouped client-side, so the roster can render each coach's pending
 * request(s) without a per-coach round trip. Unlike client assignments these
 * rows carry no member data — just a coach id, a requested tier, and a note —
 * so loading them all is cheap and leaks nothing.
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
 * Loads the ACTIVE assignments for ONE coach — the coach whose detail pane is
 * open. This used to load every active assignment on the platform and ship the
 * whole map to the browser, so every visit to this page serialized the name,
 * email, and tier of every coached member into the HTML payload: personal data
 * for thousands of people to render at most one coach's list, growing linearly
 * with the roster. The roster only needs `activeClients` COUNTS (already a
 * correlated subquery in loadCoaches); the list itself is fetched on demand,
 * one coach at a time, via the `?coach=` param.
 *
 * Joins accounts to surface the client's name/email/tier alongside the
 * assignment id (the id is what DELETE /api/admin/assignments/[id] needs).
 */
async function loadActiveClientsFor(coachId: string): Promise<ClientAssignment[]> {
  const db = getDb();
  const rows = await db
    .select({
      assignmentId: coachAssignments.id,
      userId: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      assignedAt: coachAssignments.createdAt,
    })
    .from(coachAssignments)
    .innerJoin(accounts, eq(accounts.id, coachAssignments.userId))
    .where(
      and(eq(coachAssignments.coachId, coachId), eq(coachAssignments.status, 'active')),
    )
    .orderBy(asc(accounts.displayName));

  return rows.map((r) => ({
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
  }));
}

export default async function AdminCoachesPage({
  searchParams,
}: {
  /** `?coach=<accountId>` selects which coach's client list to load. */
  searchParams: Promise<{ coach?: string | string[] }>;
}) {
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

  const [coaches, tierRequestsByCoach] = await Promise.all([
    loadCoaches(),
    loadPendingTierRequests(),
  ]);

  // Resolve `?coach=` against the real roster (an unknown/absent id falls back
  // to the first coach, matching what the roster previously highlighted). This
  // also means an arbitrary id in the URL can never make us load assignments
  // for an account that isn't a coach.
  const coachParam = (await searchParams).coach;
  const requestedCoachId = Array.isArray(coachParam) ? coachParam[0] : coachParam;
  const selectedCoach =
    coaches.find((c) => c.id === requestedCoachId) ?? coaches[0] ?? null;
  const selectedClients = selectedCoach ? await loadActiveClientsFor(selectedCoach.id) : [];

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
        selectedCoachId={selectedCoach?.id ?? null}
        selectedClients={selectedClients}
        tierRequestsByCoach={tierRequestsByCoach}
        canAssign={canAssign}
        canReview={canReview}
      />

      {canModerate ? <CoachRequestsOversight /> : null}
    </div>
  );
}
