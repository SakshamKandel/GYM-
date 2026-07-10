import { accounts, coachRequests } from '@gym/db';
import { and, asc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the caller's inbound coaching requests.
 *
 *  - GET → PENDING requests addressed to me, oldest first (first come, first
 *          served), joined to accounts for the requester's identity. Decisions
 *          happen on POST /api/coach/requests/[id].
 *
 * Ownership is intrinsic: the query only returns rows where coachId = me.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({
      id: coachRequests.id,
      userId: coachRequests.userId,
      displayName: accounts.displayName,
      tier: accounts.tier,
      message: coachRequests.message,
      createdAt: coachRequests.createdAt,
    })
    .from(coachRequests)
    .innerJoin(accounts, eq(coachRequests.userId, accounts.id))
    .where(and(eq(coachRequests.coachId, principal.id), eq(coachRequests.status, 'pending')))
    .orderBy(asc(coachRequests.createdAt));

  return json({ requests: rows }, 200);
}
