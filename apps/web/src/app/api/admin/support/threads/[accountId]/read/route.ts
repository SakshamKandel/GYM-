import { coachMessages } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — mark an account's 'support' thread read (SCALE-UP-PLAN §4.4).
 *
 *  POST (no body) → flips readByCoach=true on every inbound (sender='user')
 *  'support' row for the account. Split out of GET .../threads/[accountId]
 *  (F2): a GET is reachable via plain top-level navigation — SameSite=Lax
 *  still attaches the httpOnly gt_staff cookie to it — so a mutating GET was a
 *  silent GET-CSRF that could clear the inbox's unread badge (the ONLY signal
 *  of open work here, there is no separate ticket-state column) from an
 *  attacker-controlled page with no confirmation and no trace. POST is not
 *  subject to the same simple-navigation attack surface.
 *
 * Guarded by requirePermission('support.thread.read') — same read-side
 * permission as loading the thread; marking read is part of "viewing" it, not
 * a distinct write capability.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'support.thread.read');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;
  const db = getDb();

  await db
    .update(coachMessages)
    .set({ readByCoach: true })
    .where(
      and(
        eq(coachMessages.accountId, accountId),
        eq(coachMessages.kind, 'support'),
        eq(coachMessages.sender, 'user'),
        eq(coachMessages.readByCoach, false),
      ),
    );

  return json({ ok: true }, 200);
}
