import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — a client's nutrition adherence (Pack K read layer).
 *
 * REALITY CHECK (frozen against live schema): the member's food log lives ONLY
 * in device-side SQLite. The nutrition SQLite↔Neon sync queue is the pre-existing
 * open workstream explicitly DEFERRED in the v1.1 plan (§6) — there is no
 * account-scoped food_logs / nutrition table on Neon today (the `food_logs`
 * table is the legacy profiles-scoped local schema, written by no server route).
 *
 * So this route is the STABLE FRONT DOOR the client-detail page reads: it
 * returns `synced: false` today (the UI shows "nutrition isn't synced to the
 * server yet"), and when the sync epic lands it flips to real day rows WITHOUT a
 * client-contract change — the coach page already renders whatever `days` holds.
 *
 * Guards (fail closed): requirePermission('coach.user.read') +
 * requireCoachOwnsUser(userId), so the shape and its guards are correct from day
 * one even while the data source is pending.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  // No server-side nutrition source yet (§6). Honest empty payload — never a
  // fabricated adherence number a coach might act on.
  return json({ synced: false, days: [] as never[] }, 200);
}
