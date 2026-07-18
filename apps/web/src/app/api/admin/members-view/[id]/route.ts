import { requirePermission } from '@/lib/authz';
import { json, preflight } from '@/lib/http';
import { loadMemberSnapshot } from '@/lib/memberSnapshot';

export const runtime = 'nodejs';

/**
 * Admin console — curated, read-only member snapshot (gap build P2-19,
 * "read-only member impersonation view"). NOT the raw `account_profiles`
 * JSON blob (onboarding health/goal answers) — see `@/lib/memberSnapshot`'s
 * doc comment for exactly what this does and does not include.
 *
 * This is a STANDALONE contract: W1 owns `MemberDrawer.tsx` and may or may
 * not wire a "View as member" tab against this route (per the wave brief).
 * Either way it also renders as its own page at
 * `admin/members/[id]/view/page.tsx` (this package owns that page).
 *
 * Guarded by requirePermission('members.read') — the same permission the
 * member directory/drawer already require, so nothing here widens access
 * beyond what a members.read holder can already piece together from the
 * directory + audit log; this route just curates it into one read.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'members.read');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const snapshot = await loadMemberSnapshot(id);
  if (!snapshot.found) return json({ error: 'not_found' }, 404);

  return json(snapshot, 200);
}
