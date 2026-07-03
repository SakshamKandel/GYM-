import { accounts, coachAssignments, coachMessages } from '@gym/db';
import { and, eq, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the caller's assigned roster.
 *
 *  - GET → every user with an ACTIVE coach_assignments row where coachId = me,
 *          joined to accounts for identity, each carrying `unreadForCoach`
 *          (count of that user's inbound coach_chat messages not yet read by
 *          the coach). Drives the console's client list + unread badges.
 *
 * Guarded by requirePermission('coach.user.read'); super_admin passes too.
 * Ownership is intrinsic here — the query only ever returns rows assigned to
 * the caller (per-user ownership is enforced separately on the thread routes).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const db = getDb();

  // Correlated unread count: inbound (sender='user') coach_chat rows in this
  // user's thread that the coach hasn't read yet. Kept as a subquery so the
  // roster stays one round-trip and each row carries its own badge.
  const unreadForCoach = sql<number>`(
    select count(*)::int
    from ${coachMessages}
    where ${coachMessages.accountId} = ${accounts.id}
      and ${coachMessages.kind} = 'coach_chat'
      and ${coachMessages.sender} = 'user'
      and ${coachMessages.readByCoach} = false
  )`;

  const rows = await db
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
      tier: accounts.tier,
      unreadForCoach,
    })
    .from(coachAssignments)
    .innerJoin(accounts, eq(coachAssignments.userId, accounts.id))
    .where(
      and(
        eq(coachAssignments.coachId, principal.id),
        eq(coachAssignments.status, 'active'),
      ),
    )
    .orderBy(accounts.displayName);

  return json({ users: rows }, 200);
}
