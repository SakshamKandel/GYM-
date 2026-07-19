import { accounts, coachApplications } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — the coach-enrollment review queue (SCALE-UP-PLAN §4.2).
 *
 *  - GET ?status=pending|approved|rejected (default pending) → applications in
 *    that status, newest first, each joined to `accounts` for the applicant's
 *    identity. This is a STAFF-facing payload — unlike member-facing coach
 *    surfaces, showing the applicant's email here is intentional (mirrors
 *    /api/coach/suggestions' `user` join).
 *
 * Guarded by requirePermission('coach.application.review'); member_admin +
 * super_admin/main_admin.
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
      id: coachApplications.id,
      account: {
        id: accounts.id,
        displayName: accounts.displayName,
        email: accounts.email,
      },
      displayName: coachApplications.displayName,
      headline: coachApplications.headline,
      bio: coachApplications.bio,
      yearsExperience: coachApplications.yearsExperience,
      specialties: coachApplications.specialties,
      certifications: coachApplications.certifications,
      achievements: coachApplications.achievements,
      avatarUrl: coachApplications.avatarUrl,
      status: coachApplications.status,
      reviewNote: coachApplications.reviewNote,
      createdAt: coachApplications.createdAt,
    })
    .from(coachApplications)
    .innerJoin(accounts, eq(accounts.id, coachApplications.accountId))
    .where(eq(coachApplications.status, status))
    .orderBy(desc(coachApplications.createdAt))
    // Pending must never starve behind a flat cap (P1-11): load it unbounded up
    // to a high safety ceiling; decided history stays capped.
    .limit(status === 'pending' ? 2000 : 200);

  return json({ applications: rows }, 200);
}
