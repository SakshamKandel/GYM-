import { accounts, referrals } from '@gym/db';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  inviteeEmail: z.string().email(),
});

/** Hard ceiling on referral rows per referrer — bounds table growth and probing. */
const MAX_REFERRALS_PER_ACCOUNT = 100;

export function OPTIONS() {
  return preflight();
}

/** GET — list this user's referrals and their status. */
export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const rows = await db
    .select({
      id: referrals.id,
      inviteeEmail: referrals.inviteeEmail,
      status: referrals.status,
      createdAt: referrals.createdAt,
      rewardedAt: referrals.rewardedAt,
    })
    .from(referrals)
    .where(eq(referrals.referrerId, me.id))
    .orderBy(referrals.createdAt);

  return json({ referrals: rows }, 200);
}

/** POST — create a referral invite for a friend's email. */
export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  // 10 referrals/hour/account — makes bulk email probing expensive on top of
  // the uniform response below (same budget as buddy/invite).
  const limited = rateLimit({
    route: 'buddy/referrals',
    limit: 10,
    windowMs: 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.inviteeEmail.toLowerCase();
  const db = getDb();

  // ANTI-ORACLE: every outcome that would reveal whether `email` has an
  // account returns this SAME 201 body — the old {status:'joined'|'pending'}
  // reply was a free account-existence oracle. The mobile client ignores the
  // POST body (apps/mobile/src/lib/api/client.ts createReferral) and re-reads
  // the list via GET. Errors that only concern the CALLER'S OWN state (their
  // duplicate invite) stay specific — they leak nothing the caller doesn't
  // already know. Mirrors /api/buddy/invite.
  const recorded = () => json({ ok: true, recorded: true }, 201);

  // Check if this referrer already invited this email (matches the
  // (referrerId, inviteeEmail) unique index).
  const existing = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(eq(referrals.referrerId, me.id), eq(referrals.inviteeEmail, email)))
    .limit(1);

  if (existing.length > 0) return json({ error: 'already_linked' }, 409);

  // Hard cap per referrer. Uniform response — the cap being hit must not
  // itself become a probing signal, so the referral is silently dropped.
  const totalRows = await db
    .select({ n: count() })
    .from(referrals)
    .where(eq(referrals.referrerId, me.id));
  if ((totalRows[0]?.n ?? 0) >= MAX_REFERRALS_PER_ACCOUNT) return recorded();

  // Check if the invitee already has an account — if so, mark as joined.
  // The result only ever surfaces through the referrer's own GET list, never
  // through this response.
  const inviteeAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);

  const status = inviteeAccount[0] ? 'joined' : 'pending';

  // CONCURRENCY: the duplicate pre-check above is check-then-insert (TOCTOU) —
  // two concurrent POSTs for the same email would collide on the
  // referrals_referrer_email unique index as an uncaught 500. onConflictDoNothing
  // maps the loser to the same already_linked 409 the pre-check uses (the
  // caller's own state — see ANTI-ORACLE).
  const created = await db
    .insert(referrals)
    .values({
      referrerId: me.id,
      inviteeEmail: email,
      inviteeId: inviteeAccount[0]?.id ?? null,
      status,
    })
    .onConflictDoNothing({ target: [referrals.referrerId, referrals.inviteeEmail] })
    .returning({ id: referrals.id });
  if (created.length === 0) return json({ error: 'already_linked' }, 409);

  return recorded();
}
