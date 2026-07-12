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

  // Immediate-join path (SCALE-UP-PLAN §4.1/§7.2): the invitee already had an
  // account at invite time, so this brand-new row lands DIRECTLY as 'joined'
  // — grant both parties the 20%/90-day referral discount now. The other
  // transition path (invitee registers AFTER being invited) is wired in
  // auth/register + auth/google.
  //
  // ANTI-ORACLE (cont'd): this branch does several extra DB round-trips that
  // the 'pending' branch never does. Doing them inline would leak the exact
  // membership signal the uniform 201 body is supposed to hide, via response
  // latency (joined replies measurably slower than pending). `after()` defers
  // this work until AFTER the response has already been sent, so every
  // caller sees identical pre-response work regardless of outcome. Best-effort:
  // never fail (or delay) the invite response for this.
  if (status === 'joined' && inviteeAccount[0]) {
    const referrerId = me.id;
    const inviteeId = inviteeAccount[0].id;
    after(async () => {
      const expiresAt = new Date(Date.now() + REFERRAL_GRANT_DAYS * 24 * 60 * 60 * 1000);
      try {
        await grantDiscount({
          accountId: referrerId,
          source: 'referral',
          pct: REFERRAL_DISCOUNT_PCT,
          expiresAt,
        });
        await grantDiscount({
          accountId: inviteeId,
          source: 'referral',
          pct: REFERRAL_DISCOUNT_PCT,
          expiresAt,
        });
      } catch {
        // Best-effort — the discount catalog simply won't reflect it until
        // reconciled; the referral row itself still recorded successfully.
      }
    });
  }

  // Invite-vs-register race repair (W6 sweep): the invitee may finish
  // registering in the gap between the accounts pre-check above and this row
  // landing as 'pending'. auth/register's and auth/google's own wiring only
  // matches referral rows that already EXIST at the moment the invitee's
  // account is created — a registration that raced ahead of this insert
  // would have found nothing to update, leaving this row stranded at
  // 'pending' with a null inviteeId forever. Recheck once, inside after() so
  // this extra lookup never affects response timing (same ANTI-ORACLE
  // reasoning as the immediate-join branch above).
  if (status === 'pending') {
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
        // Best-effort — same reasoning as the immediate-join branch above.
      }
    });
  }

  return recorded();
}
