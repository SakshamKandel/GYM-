import { accounts, coachProfiles, coachTierRequests } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — the coach seniority-tier upgrade review queue
 * (SCALE-UP-PLAN §4.2).
 *
 *  - GET ?status=pending|approved|rejected (default pending) → requests in
 *    that status, newest first, joined to the requesting coach's identity +
 *    CURRENT coachTier (so the reviewer can see what they're upgrading from).
 *
 * Guarded by requirePermission('coach.application.review').
 */

const STATUSES = ['pending', 'approved', 'rejected'] as const;
type Status = (typeof STATUSES)[number];

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.application.review');
  if (principal instanceof Response) return principal;

  const raw = new URL(req.url).searchParams.get('status') ?? 'pending';
  if (!(STATUSES as readonly string[]).includes(raw)) return json({ error: 'invalid' }, 400);
  const status = raw as Status;

  const rows = await getDb()
    .select({
      id: coachTierRequests.id,
      coach: {
        id: accounts.id,
        displayName: accounts.displayName,
        coachTier: coachProfiles.coachTier,
      },
      requestedTier: coachTierRequests.requestedTier,
      note: coachTierRequests.note,
      status: coachTierRequests.status,
      createdAt: coachTierRequests.createdAt,
    })
    .from(coachTierRequests)
    .innerJoin(accounts, eq(accounts.id, coachTierRequests.coachId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachTierRequests.coachId))
    .where(eq(coachTierRequests.status, status))
    .orderBy(desc(coachTierRequests.createdAt))
    .limit(200);

  // coachProfiles is left-joined — a coach granted the role via
  // POST /api/admin/staff has no coach_profiles row yet, so coachTier comes
  // back null. Default to 'silver' (the schema default), same fallback the
  // sibling /api/admin/wallets route already applies, so the mobile admin's
  // adminCoachTierRequestSchema (coachTier: enum, no null) never fails to
  // parse and silently drop the row from the review queue.
  const requests = rows.map((r) => ({
    ...r,
    coach: { ...r.coach, coachTier: r.coach.coachTier ?? 'silver' },
  }));

  return json({ requests }, 200);
}
