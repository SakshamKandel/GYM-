import { accounts, buddyLinks } from '@gym/db';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { acceptedBuddyCount, authedUser, BUDDY_LIMIT } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().email(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  // 10 invites/hour/account — makes bulk email probing expensive on top of
  // the uniform response below.
  const limited = rateLimit({
    route: 'buddy/invite',
    limit: 10,
    windowMs: 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.email.toLowerCase();
  const db = getDb();

  // ANTI-ORACLE: every outcome that would reveal whether `email` has an
  // account returns this SAME 201 body (the mobile client deliberately ignores
  // the invite response body — apps/mobile/src/lib/api/client.ts inviteBuddy).
  // Errors that only concern the CALLER'S OWN state (self-invite, own buddy
  // limit, an already-linked pair the caller is part of) stay specific — they
  // leak nothing the caller doesn't already know.
  const recorded = () => json({ ok: true, invited: true }, 201);

  const targets = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  const target = targets[0];
  // No such account: indistinguishable from a successful invite.
  if (!target) return recorded();
  if (target.id === me.id) return json({ error: 'invalid' }, 400);

  // Any link in either direction (pending or accepted) blocks a new invite.
  const existing = await db
    .select({ id: buddyLinks.id })
    .from(buddyLinks)
    .where(
      or(
        and(eq(buddyLinks.requesterId, me.id), eq(buddyLinks.addresseeId, target.id)),
        and(eq(buddyLinks.requesterId, target.id), eq(buddyLinks.addresseeId, me.id)),
      ),
    )
    .limit(1);
  if (existing.length > 0) return json({ error: 'already_linked' }, 409);

  const [mine, theirs] = await Promise.all([
    acceptedBuddyCount(db, me.id),
    acceptedBuddyCount(db, target.id),
  ]);
  // The caller's own limit is their own state — a specific error is fine.
  if (mine >= BUDDY_LIMIT) return json({ error: 'buddy_limit' }, 409);
  // The TARGET's limit would confirm the account exists — swallow it. The
  // invite is silently dropped, same outward result as a non-existent email.
  if (theirs >= BUDDY_LIMIT) return recorded();

  // CONCURRENCY: the pre-check above is a check-then-insert (TOCTOU). A double-
  // tap, or two same-direction invites that both passed the SELECT before either
  // committed, collide on the buddy_links_requester_addressee unique index.
  // onConflictDoNothing turns that unique-violation into an empty result instead
  // of an uncaught Postgres 500 (which the mobile zod boundary can't map to a
  // typed code), letting us reply with the same already_linked 409 the pre-check
  // uses. Only concerns the caller's own pair — leaks nothing (see ANTI-ORACLE).
  const created = await db
    .insert(buddyLinks)
    .values({ requesterId: me.id, addresseeId: target.id })
    .onConflictDoNothing({ target: [buddyLinks.requesterId, buddyLinks.addresseeId] })
    .returning({
      id: buddyLinks.id,
      requesterId: buddyLinks.requesterId,
      addresseeId: buddyLinks.addresseeId,
      status: buddyLinks.status,
      createdAt: buddyLinks.createdAt,
    });

  const link = created[0];
  if (!link) return json({ error: 'already_linked' }, 409);

  // Notify the addressee — fire-and-forget; never blocks or breaks the response.
  const requesterName = me.displayName || me.email;
  void sendPushToAccount(target.id, {
    title: 'New gym buddy request',
    body: `${requesterName} wants to train with you`,
    data: { type: 'buddy_invite', linkId: link.id },
  });

  // Uniform body — see ANTI-ORACLE note above (the {link} body was unused).
  return recorded();
}
