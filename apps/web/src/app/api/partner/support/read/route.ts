import { coachMessages } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Mark the platform team's replies in the caller's OWN support thread as read.
 *
 * Split out of the GET on purpose (same reasoning as the admin inbox): a GET is
 * reachable from a plain top-level navigation with the session cookie attached,
 * so a mutating GET would let any link silently clear the unread badge the
 * portal's alert dock relies on to say "the team wrote back".
 *
 * Own-thread only — the account id comes from the session, never a parameter.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;

  await getDb()
    .update(coachMessages)
    .set({ readByUser: true })
    .where(
      and(
        eq(coachMessages.accountId, guard.principal.id),
        eq(coachMessages.kind, 'support'),
        eq(coachMessages.sender, 'coach'),
        eq(coachMessages.readByUser, false),
      ),
    );

  return json({ ok: true }, 200);
}
