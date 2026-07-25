import { coachAssignments, coachProfiles, coachRequests } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { bearerToken, userForToken } from '@/lib/auth';
import { logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { optimizedImageUrl } from '@/lib/video/cloudinaryProvider';

export const runtime = 'nodejs';

/**
 * Widest the assigned coach's portrait is ever painted: the 48dp Home entry
 * avatar (the chat header is 40dp), so ~144px on a 3x screen. Coaches upload
 * phone-camera originals, so without this the Home card downloads a multi-
 * megabyte photo into a thumbnail on every cold start. `optimizedImageUrl` caps
 * the delivered width and negotiates format/quality on the way out; the stored
 * URL is untouched, and a signed/foreign/already-transformed URL passes through
 * exactly as it is.
 */
const COACH_AVATAR_MAX_WIDTH = 192;

/**
 * The signed-in member's mentorship state in one call:
 *
 *  - GET    → coach: the NEWEST active assignment's coach card, or null when
 *             the member is unassigned; request: the member's pending coach
 *             request (at most one exists — the POST route enforces it), or
 *             null.
 *  - DELETE → the member ends their OWN coaching.
 *
 * Why DELETE lives here: ending a coaching relationship used to be something
 * only the coach (DELETE /api/coach/users/[userId]) or an admin could do, so a
 * member who wanted out had to ask the very person they wanted to leave. This
 * is the member-owned half of the same action, and it is deliberately the
 * narrowest possible endpoint: it takes no target, and only ever touches rows
 * where `userId` is the caller. There is nothing to pass, so there is nothing
 * to tamper with.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  // Two independent single-row reads on the same account — issued together so
  // the member's Home card costs one round trip, not two.
  const [assignments, pendings] = await Promise.all([
    db
      .select({
        coachId: coachAssignments.coachId,
        displayName: coachProfiles.displayName,
        headline: coachProfiles.headline,
        avatarUrl: coachProfiles.avatarUrl,
      })
      .from(coachAssignments)
      .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachAssignments.coachId))
      .where(
        and(eq(coachAssignments.userId, user.id), eq(coachAssignments.status, 'active')),
      )
      .orderBy(desc(coachAssignments.createdAt))
      .limit(1),
    db
      .select({
        id: coachRequests.id,
        coachId: coachRequests.coachId,
        coachName: coachProfiles.displayName,
        createdAt: coachRequests.createdAt,
      })
      .from(coachRequests)
      .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachRequests.coachId))
      .where(and(eq(coachRequests.userId, user.id), eq(coachRequests.status, 'pending')))
      .orderBy(desc(coachRequests.createdAt))
      .limit(1),
  ]);

  const assignment = assignments[0];
  const storedAvatarUrl = assignment?.avatarUrl ?? null;
  const coach = assignment
    ? {
        id: assignment.coachId,
        displayName: assignment.displayName || 'Coach',
        headline: assignment.headline ?? '',
        avatarUrl:
          storedAvatarUrl === null
            ? null
            : optimizedImageUrl(storedAvatarUrl, { maxWidth: COACH_AVATAR_MAX_WIDTH }),
      }
    : null;

  const pending = pendings[0];
  const request = pending
    ? {
        id: pending.id,
        coachId: pending.coachId,
        coachName: pending.coachName || 'Coach',
        status: 'pending' as const,
        createdAt: pending.createdAt,
      }
    : null;

  return json({ coach, request }, 200);
}

/**
 * DELETE — end the caller's own active coaching.
 *
 * Rows are ENDED, never deleted: the pair's history survives (plans, messages
 * and milestones the member already has stay exactly where they are), and the
 * partial-unique index lets a future accept reactivate the same pair.
 *
 * The one-active-coach invariant holds by construction. The update is scoped to
 * (userId = caller, status = 'active') and ends every row it matches, so the
 * caller comes out of it with zero active assignments whatever it found — this
 * can only ever reduce the count, never split it.
 *
 * 404 when there was nothing live to end (never assigned, or the coach/an admin
 * got there first). That is not a leak: it is the caller's own state, which
 * GET above already returns in full.
 *
 * The notification goes to the COACH, not the member. The member just pressed
 * the button and is looking at the result; the coach is the one who needs to
 * know a client left. Fire-and-forget (§7.1): losing the notice must never fail
 * an end the member already confirmed.
 */
export async function DELETE(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // Ending is rare and one-way; a budget this small costs a real member
  // nothing and keeps a stolen token from churning assignments.
  const limited = rateLimit({
    route: 'me/coach/end',
    limit: 5,
    windowMs: 60 * 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const ended = await getDb()
    .update(coachAssignments)
    .set({ status: 'ended' })
    .where(
      and(eq(coachAssignments.userId, user.id), eq(coachAssignments.status, 'active')),
    )
    .returning({ coachId: coachAssignments.coachId });

  if (ended.length === 0) return json({ error: 'not_found' }, 404);

  await logAudit(
    { id: user.id },
    'coach.unassign_by_member',
    'account',
    user.id,
    { coachIds: ended.map((row) => row.coachId), assignments: ended.length },
    clientIp(req),
  );

  // §7.2-S2: the display name is member-authored text reaching a privileged
  // recipient, so it is masked and attributed rather than trusted.
  const who = maskPii(user.displayName).trim() || 'A member';
  // No `id` on purpose: the coach no longer owns this client, so a deep link to
  // that client's page would land on a wall. Bare 'coach_client' opens the
  // roster, which is where the change is visible.
  for (const row of ended) {
    after(() =>
      notify(
        'coach_unassigned',
        { accountId: row.coachId },
        {
          title: 'A client ended their coaching',
          body: `${who} is no longer on your client list.`,
          data: { type: 'coach_client' },
        },
      ),
    );
  }

  return json({ ok: true }, 200);
}
