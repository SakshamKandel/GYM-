import { accounts, referrals } from '@gym/db';
import { and, count, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { grantDiscount } from '@/lib/promoEconomy';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  inviteeEmail: z.string().email(),
});

/** Hard ceiling on referral rows per referrer — bounds table growth and probing. */
const MAX_REFERRALS_PER_ACCOUNT = 100;

/** Referral reward window (SCALE-UP-PLAN §1.3 / §7.2). */
const REFERRAL_DISCOUNT_PCT = 20;
const REFERRAL_GRANT_DAYS = 90;

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

  const recorded = () => json({ ok: true, recorded: true }, 201);

  // Check if this referrer already invited this email (matches the
  // (referrerId, inviteeEmail) unique index). This error only concerns the
  // caller's OWN state — it leaks nothing they don't already know.
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

  // ANTI-ORACLE (2026-07-10 hardening, restored): every outcome that would
  // reveal whether `email` has an account returns the SAME uniform 201 body.
  // A distinct "already enrolled" error would let any signed-in caller
  // confirm which emails hold accounts by response-differencing — the rate
  // limit only slows that oracle, it doesn't close it. The row is inserted
  // either way (born 'joined' when the invitee already has an account) so a
  // REPEAT post of the same email is also uniform: it hits already_linked
  // regardless of enrollment. Errors that only concern the CALLER'S OWN
  // state (their duplicate invite) stay specific — they leak nothing the
  // caller doesn't already know.
  //
  // Product rule (2026-07-17): invites reward only people NEW to the app.
  // That holds here — a row born 'joined' never passes through the
  // 'pending' → 'joined' transition that auth/register, auth/google, and the
  // after() repair below gate the 20%/90-day discounts on, so a pre-enrolled
  // invitee grants nothing to either party.
  const inviteeAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  const invitee = inviteeAccount[0];

  // CONCURRENCY: the duplicate pre-check above is check-then-insert (TOCTOU) —
  // two concurrent POSTs for the same email would collide on the
  // referrals_referrer_email unique index as an uncaught 500. onConflictDoNothing
  // maps the loser to the same already_linked 409 the pre-check uses.
  const created = await db
    .insert(referrals)
    .values({
      referrerId: me.id,
      inviteeEmail: email,
      inviteeId: invitee?.id ?? null,
      status: invitee ? 'joined' : 'pending',
    })
    .onConflictDoNothing({ target: [referrals.referrerId, referrals.inviteeEmail] })
    .returning({ id: referrals.id });
  if (created.length === 0) return json({ error: 'already_linked' }, 409);

  // Pre-enrolled invitee: recorded, no reward (see product rule above).
  if (invitee) return recorded();

  // Invite-vs-register race repair (W6 sweep): the invitee may finish
  // registering in the gap between the accounts pre-check above and this row
  // landing as 'pending'. auth/register's and auth/google's own wiring only
  // matches referral rows that already EXIST at the moment the invitee's
  // account is created — a registration that raced ahead of this insert
  // would have found nothing to update, leaving this row stranded at
  // 'pending' with a null inviteeId forever. Recheck once, inside after() so
  // this extra lookup never affects response timing. (The normal
  // invitee-registers-later transition to 'joined' — with the 20%/90-day
  // discount for both parties — stays wired in auth/register + auth/google.)
  const referralId = created[0]!.id;
  const referrerId = me.id;
  after(async () => {
    try {
      const account = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email))
        .limit(1);
      if (!account[0]) return;

      // WHERE ... status='pending' makes this idempotent against a
      // concurrent auth/register|auth/google wiring pass touching the SAME
      // row (matched there by email+pending) — whichever writer's UPDATE
      // lands first wins the flip; the loser's WHERE clause matches
      // nothing, so the referral is never double-granted.
      const upgraded = await db
        .update(referrals)
        .set({ inviteeId: account[0].id, status: 'joined' })
        .where(and(eq(referrals.id, referralId), eq(referrals.status, 'pending')))
        .returning({ id: referrals.id });
      if (upgraded.length === 0) return;

      const expiresAt = new Date(Date.now() + REFERRAL_GRANT_DAYS * 24 * 60 * 60 * 1000);
      await grantDiscount({
        accountId: referrerId,
        source: 'referral',
        pct: REFERRAL_DISCOUNT_PCT,
        expiresAt,
      });
      await grantDiscount({
        accountId: account[0].id,
        source: 'referral',
        pct: REFERRAL_DISCOUNT_PCT,
        expiresAt,
      });
    } catch {
      // Best-effort — the discount catalog simply won't reflect it until
      // reconciled; the referral row itself still recorded successfully.
    }
  });

  return recorded();
}
