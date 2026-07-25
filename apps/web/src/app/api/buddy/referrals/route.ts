import { accounts, discountGrants, referrals } from '@gym/db';
import { and, count, eq, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import type { PublicUser } from '@/lib/auth';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  grantDiscount,
  REFERRAL_DISCOUNT_PCT,
  REFERRAL_GRANT_DAYS,
} from '@/lib/promoEconomy';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const sendSchema = z.object({
  inviteeEmail: z.string().email(),
});

const redeemSchema = z.object({
  inviteCode: z.string().min(1).max(64),
});

/** Hard ceiling on referral rows per referrer — bounds table growth and probing. */
const MAX_REFERRALS_PER_ACCOUNT = 100;

/**
 * How long after sign-up a member may still enter a friend's invite code.
 * Invites reward people NEW to the app (product rule, 2026-07-17); without a
 * window two long-standing members could swap codes and mint each other a
 * discount at any time.
 */
const REDEEM_WINDOW_DAYS = 14;

// ── Shareable invite code ──────────────────────────────────────
// The code IS the referrer's account id, re-encoded — no new column, so this
// ships without a migration. Crockford base32 (no I/L/O/U) over the uuid's 128
// bits: 26 characters, uppercase, unambiguous when read aloud, and reversible
// server-side. It is deliberately NOT the same string as the membership-card
// member code (that one is the raw id in hex and gets shown to restaurant
// staff) so that sharing an invite around does not hand out a code that also
// works at a counter.

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Account id (uuid) → 26-char shareable code, or null if the id isn't a uuid. */
function inviteCodeForAccount(accountId: string): string | null {
  const hex = accountId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;

  let bits = '';
  for (const ch of hex) bits += parseInt(ch, 16).toString(2).padStart(4, '0');
  bits += '00'; // 128 bits → 130 = 26 groups of 5

  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += CODE_ALPHABET.charAt(parseInt(bits.slice(i, i + 5), 2));
  }
  return out;
}

/** Shareable code (spacing/case/O↔0/I↔1 tolerated) → account id, or null. */
function accountIdForInviteCode(raw: string): string | null {
  const normalized = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[ILO]/g, (c) => (c === 'O' ? '0' : '1'));
  if (normalized.length !== 26) return null;

  let bits = '';
  for (const ch of normalized) {
    const value = CODE_ALPHABET.indexOf(ch);
    if (value < 0) return null;
    bits += value.toString(2).padStart(5, '0');
  }
  // The two trailing bits are padding — a non-zero tail is not a code we minted.
  if (bits.slice(128) !== '00') return null;

  let hex = '';
  for (let i = 0; i < 128; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Did a referral discount ACTUALLY land for this row? (Defect fix, 2026-07-25.)
 *
 * A row born 'joined' — the invitee already had an account when the invite was
 * recorded — never passes through the pending → joined transition the grants
 * hang off, so nobody is rewarded for it. It used to be indistinguishable from
 * a genuine join in this response, and the app rendered both as "Discount
 * unlocked". This checks the thing the label actually claims: a referral-source
 * discount grant for the invitee dated at or after the invite was recorded.
 * True for every path that grants (invitee registers later, the race repair
 * below, a code redemption); false for recorded-only rows, and false when a
 * best-effort grant failed — which is the safe direction to be wrong in.
 *
 * The grant also has to be attributable to THIS invite, hence the second pair
 * of conditions: either the friend signed up after the invite was recorded (so
 * the grant they hold came from it), or the grant was written within moments of
 * the row, which is what a code redemption does inside a single request. That
 * stops an unrelated referral discount the friend picks up days later from
 * lighting up a row that never rewarded anyone.
 *
 * This lives in the caller-scoped GET, never in the POST response: POST stays
 * byte-identical for every outcome so it can't be used to test whether an email
 * has an account (see the anti-oracle note in POST).
 */
const discountEarnedSql = sql<boolean>`exists (
  select 1 from ${discountGrants}
  where ${discountGrants.accountId} = ${referrals.inviteeId}
    and ${discountGrants.source} = 'referral'
    and ${discountGrants.createdAt} >= ${referrals.createdAt}
    and (
      ${accounts.createdAt} > ${referrals.createdAt}
      or ${discountGrants.createdAt} <= ${referrals.createdAt} + interval '5 minutes'
    )
)`;

export function OPTIONS() {
  return preflight();
}

/** GET — this user's invite code, their sent invites, and each one's status. */
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
      discountEarned: discountEarnedSql,
    })
    .from(referrals)
    // Joined only so discountEarnedSql can compare the friend's sign-up date
    // with the invite date; nothing about the friend is returned.
    .leftJoin(accounts, eq(accounts.id, referrals.inviteeId))
    .where(eq(referrals.referrerId, me.id))
    .orderBy(referrals.createdAt);

  // Own account: how long ago it was created, and whether a referral discount
  // has ever been granted to it — together these say whether this member can
  // still use a friend's code, so the app only offers what will work.
  const self = (
    await db
      .select({
        createdAt: accounts.createdAt,
        hasReferralGrant: sql<boolean>`exists (
          select 1 from ${discountGrants}
          where ${discountGrants.accountId} = ${accounts.id}
            and ${discountGrants.source} = 'referral'
        )`,
      })
      .from(accounts)
      .where(eq(accounts.id, me.id))
      .limit(1)
  )[0];

  return json(
    {
      // Existing shape, plus discountEarned. Older clients ignore the new key.
      referrals: rows.map((r) => ({ ...r, discountEarned: r.discountEarned === true })),
      invite: {
        code: inviteCodeForAccount(me.id),
        // The public download page on this same site — the member shares it
        // themselves through whatever app they like; nothing is sent from here.
        shareUrl: `${new URL(req.url).origin}/download`,
        discountPct: REFERRAL_DISCOUNT_PCT,
        rewardDays: REFERRAL_GRANT_DAYS,
        redeemWindowDays: REDEEM_WINDOW_DAYS,
        canRedeem: self ? !self.hasReferralGrant && withinRedeemWindow(self.createdAt) : false,
      },
    },
    200,
  );
}

function withinRedeemWindow(accountCreatedAt: Date): boolean {
  const ageMs = Date.now() - accountCreatedAt.getTime();
  return ageMs <= REDEEM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * POST — two actions on one route (one call site, one rate-limit family):
 *  - `{ inviteCode }`  a new member uses a friend's shared code.
 *  - `{ inviteeEmail }` the older path: record a friend's email so the reward
 *    lands automatically when they sign up with it. Nothing is emailed — no
 *    delivery seam exists — so the app no longer claims an invite was sent.
 */
export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const raw = await readJson(req);

  const redeem = redeemSchema.safeParse(raw);
  if (redeem.success) return redeemInviteCode(req, me, redeem.data.inviteCode);

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

  const parsed = sendSchema.safeParse(raw);
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
  // invitee grants nothing to either party. GET marks those rows
  // discountEarned:false so the app stops calling them a reward.
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

/**
 * A new member uses the code a friend shared with them: link the referral and
 * grant BOTH parties the same 20%/90-day discount the email path grants.
 *
 * Every refusal here is about the CALLER'S OWN account (own code, already used
 * a code, past the new-member window) except `invalid_code`, which is uniform
 * for a malformed code, an unknown one, and a suspended referrer. Codes carry
 * the referrer's 128-bit account id, so guessing one is not a way to learn
 * whether an account exists — and the email path's anti-oracle is untouched.
 *
 * The per-referrer row cap does NOT apply here: a redemption needs a real new
 * account and each account may use exactly one code ever, so this path can't be
 * used to grow the table on demand.
 */
async function redeemInviteCode(
  req: Request,
  me: PublicUser,
  rawCode: string,
): Promise<Response> {
  const limited = rateLimit({
    route: 'buddy/referrals/redeem',
    limit: 10,
    windowMs: 60 * 60 * 1000,
    accountId: me.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const referrerId = accountIdForInviteCode(rawCode);
  if (!referrerId) return json({ error: 'invalid_code' }, 404);
  if (referrerId === me.id) return json({ error: 'own_code' }, 409);

  const db = getDb();

  // Eligibility is keyed on the DISCOUNT, not on referral rows: someone else
  // recording your email as an invite (recorded-only, no reward) must not
  // quietly burn your one redemption.
  const self = (
    await db
      .select({
        createdAt: accounts.createdAt,
        hasReferralGrant: sql<boolean>`exists (
          select 1 from ${discountGrants}
          where ${discountGrants.accountId} = ${accounts.id}
            and ${discountGrants.source} = 'referral'
        )`,
      })
      .from(accounts)
      .where(eq(accounts.id, me.id))
      .limit(1)
  )[0];
  if (!self) return json({ error: 'unauthorized' }, 401);
  if (self.hasReferralGrant === true) return json({ error: 'code_already_used' }, 409);
  if (!withinRedeemWindow(self.createdAt)) return json({ error: 'not_new_member' }, 409);

  const referrer = (
    await db
      .select({ id: accounts.id, status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, referrerId))
      .limit(1)
  )[0];
  if (!referrer || referrer.status !== 'active') return json({ error: 'invalid_code' }, 404);

  const email = me.email.toLowerCase();

  // The friend may ALSO have recorded this email already: reuse that pending
  // row rather than colliding with the (referrerId, inviteeEmail) unique index.
  const flipped = await db
    .update(referrals)
    .set({ inviteeId: me.id, status: 'joined' })
    .where(
      and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.inviteeEmail, email),
        eq(referrals.status, 'pending'),
      ),
    )
    .returning({ id: referrals.id });

  const reusedRowId = flipped[0]?.id ?? null;
  let insertedRowId: string | null = null;
  if (reusedRowId === null) {
    const created = await db
      .insert(referrals)
      .values({
        referrerId,
        inviteeEmail: email,
        inviteeId: me.id,
        status: 'joined',
      })
      .onConflictDoNothing({ target: [referrals.referrerId, referrals.inviteeEmail] })
      .returning({ id: referrals.id });
    // A non-pending row already links this pair — this code is spent.
    if (created.length === 0) return json({ error: 'code_already_used' }, 409);
    insertedRowId = created[0]!.id;
  }

  const expiresAt = new Date(Date.now() + REFERRAL_GRANT_DAYS * 24 * 60 * 60 * 1000);
  try {
    // Referrer FIRST, redeemer second. The redeemer's own grant is what makes
    // them ineligible to try again, so if the pair half-fails it has to be the
    // one that didn't land — otherwise a retry would be turned away as
    // "already used a code" with only half the reward given out. Re-granting
    // the referrer on a retry costs one superseded audit row and never a
    // second live discount (grantDiscount keeps one active grant per account).
    await grantDiscount({
      accountId: referrerId,
      source: 'referral',
      pct: REFERRAL_DISCOUNT_PCT,
      expiresAt,
    });
    await grantDiscount({
      accountId: me.id,
      source: 'referral',
      pct: REFERRAL_DISCOUNT_PCT,
      expiresAt,
    });
  } catch {
    // Awaited, not fire-and-forget: this response tells the member their
    // discount is on, so it must not say that unless the grant landed. Undo
    // the link so a retry can succeed.
    try {
      if (insertedRowId !== null) {
        await db.delete(referrals).where(eq(referrals.id, insertedRowId));
      } else if (reusedRowId !== null) {
        await db
          .update(referrals)
          .set({ inviteeId: null, status: 'pending' })
          .where(eq(referrals.id, reusedRowId));
      }
    } catch {
      // Nothing else to try — the next redeem attempt hits code_already_used
      // and support can reconcile from the discount_grants trail.
    }
    return json({ error: 'grant_failed' }, 503);
  }

  return json(
    {
      ok: true,
      redeemed: true,
      discountPct: REFERRAL_DISCOUNT_PCT,
      rewardDays: REFERRAL_GRANT_DAYS,
    },
    201,
  );
}
