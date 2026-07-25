import { accounts, admins, coachAssignments, coachProfiles } from '@gym/db';
import { and, count, eq, ne } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';

export const runtime = 'nodejs';

/**
 * Admin console — assign a coach to a member.
 *
 *  - POST {coachId, userId} → validates coachId is a real coach (admins row,
 *          role='coach') and userId is a real account, then upserts a
 *          coach_assignments row (status='active', assignedBy = caller). The
 *          unique (coachId,userId) index means re-assigning an ended pair
 *          reactivates it (onConflictDoUpdate → status='active').
 *
 * Guarded by requirePermission('coach.assign'); super_admin passes too.
 */

const postSchema = z.object({
  coachId: z.string().min(1),
  userId: z.string().min(1),
  // Admin override for the capacity / inactive guards below (C9). Absent =
  // enforce the coach's own limits, matching the member coach-accept flow.
  force: z.boolean().optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'coach.assign');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { coachId, userId, force } = parsed.data;

  const db = getDb();

  // coachId must be an account carrying a role='coach' admins row. The profile
  // is LEFT-joined purely for the member notification's display name — a coach
  // whose profile row hasn't been lazily created yet is still assignable.
  const coach = await db
    .select({ accountId: admins.accountId, displayName: coachProfiles.displayName })
    .from(admins)
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, admins.accountId))
    .where(and(eq(admins.accountId, coachId), eq(admins.role, 'coach')))
    .limit(1);
  if (coach.length === 0) return json({ error: 'not_a_coach' }, 400);
  const coachName = (coach[0]?.displayName ?? '').trim();

  // userId must be a real account.
  const user = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .limit(1);
  if (user.length === 0) return json({ error: 'user_not_found' }, 404);

  // A coach may only be assigned over a TRUE member. Assigning one over a staff
  // account is what would let that coach rewrite the staff account's tier via
  // /api/coach/subscriptions — block it at the source. Self-assignment (a coach
  // owning themselves) is meaningless and also rejected.
  if (coachId === userId) return json({ error: 'invalid' }, 400);
  const targetStaff = await db
    .select({ accountId: admins.accountId })
    .from(admins)
    .where(eq(admins.accountId, userId))
    .limit(1);
  if (targetStaff.length > 0) return json({ error: 'invalid' }, 400);

  // Respect the coach's own limits (C9) — the member-facing coach-accept flow
  // enforces these, so admin assign must too, or a "full"/"closed" coach can be
  // overloaded from the console. An admin may knowingly override with
  // { force: true }. Skipped when the coach has no profile row (nothing to
  // enforce). Reassigning a member already on this coach doesn't consume a new
  // slot, so that member is excluded from the active-client count.
  if (!force) {
    const profile = await db
      .select({ isActive: coachProfiles.isActive, capacity: coachProfiles.capacity })
      .from(coachProfiles)
      .where(eq(coachProfiles.accountId, coachId))
      .limit(1);
    const p = profile[0];
    if (p) {
      if (p.isActive === false) return json({ error: 'inactive' }, 409);
      const activeRows = await db
        .select({ n: count() })
        .from(coachAssignments)
        .where(
          and(
            eq(coachAssignments.coachId, coachId),
            eq(coachAssignments.status, 'active'),
            ne(coachAssignments.userId, userId),
          ),
        );
      const activeClients = Number(activeRows[0]?.n ?? 0);
      if (activeClients >= p.capacity) {
        return json({ error: 'full', activeClients, capacity: p.capacity }, 409);
      }
    }
  }

  // Was this exact pair ALREADY live? Read before the upsert, because
  // `.returning()` reports the post-update row and a re-assign of an already
  // active pair must not re-tell the member "you have a coach" every click.
  const alreadyActive = await db
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachId, coachId),
        eq(coachAssignments.userId, userId),
        eq(coachAssignments.status, 'active'),
      ),
    )
    .limit(1);

  const inserted = await db
    .insert(coachAssignments)
    .values({
      coachId,
      userId,
      status: 'active',
      assignedBy: principal.id,
    })
    .onConflictDoUpdate({
      target: [coachAssignments.coachId, coachAssignments.userId],
      set: { status: 'active', assignedBy: principal.id },
    })
    .returning({
      id: coachAssignments.id,
      coachId: coachAssignments.coachId,
      userId: coachAssignments.userId,
      status: coachAssignments.status,
      assignedBy: coachAssignments.assignedBy,
      createdAt: coachAssignments.createdAt,
    });

  const assignment = inserted[0];
  if (!assignment) return json({ error: 'invalid' }, 400);

  // Enforce the singular-coach invariant (contract §4.11): a member may hold at
  // most ONE active assignment. End every OTHER active assignment for this
  // member so a reassignment doesn't leave the previous coach with lingering
  // chat/client-data/tier-grant access and make /api/me/coach nondeterministic.
  await db
    .update(coachAssignments)
    .set({ status: 'ended' })
    .where(
      and(
        eq(coachAssignments.userId, userId),
        ne(coachAssignments.coachId, coachId),
        eq(coachAssignments.status, 'active'),
      ),
    );

  await logAudit(principal, 'coach.assign', 'account', userId, { coachId });

  // The coach-side accept flow pushes the member; an ADMIN assign was silent —
  // a member gained a coach with no notice at all. Fire the same class of
  // member notification here (best-effort, never blocks or fails the assign).
  // Skipped when the pair was already active so a repeat click can't spam.
  // `data.type:'coach'` is the existing deep link: it refreshes `useMyCoach`
  // on the device and opens Coach Chat. Copy is server-templated — no operator
  // free text is echoed to the member.
  if (alreadyActive.length === 0) {
    after(() =>
      notify(
        'coach_assigned',
        { accountId: userId },
        {
          title: 'You have a coach',
          body: coachName
            ? `${coachName} is now your coach. Open Coach Chat to say hi.`
            : 'You have been matched with a coach. Open Coach Chat to say hi.',
          data: { type: 'coach' },
        },
      ),
    );
  }

  return json({ assignment }, 201);
}
