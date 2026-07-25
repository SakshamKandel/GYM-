import { createHash } from 'node:crypto';
import { accounts } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { canCreateSession } from '@/lib/accountStatus';
import { logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import {
  deliverPasswordReset,
  isPasswordResetEmailConfigured,
  type PasswordResetAdvertisedDelivery,
} from '@/lib/passwordReset';
import { clientIp, rateLimitShared } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/forgot-password — self-serve start of a password reset.
 *
 * The member sends an email address; if it belongs to a sign-in-able account,
 * the delivery seam emails them the same single-use token the admin credentials
 * tool mints (mintPasswordResetToken in @/lib/passwordReset — one mint, one
 * redemption path). The member finishes at /reset-password →
 * POST /api/auth/reset-password, which is already built and consumes the token.
 *
 * ANTI-ENUMERATION (the whole security story of this route): the response is
 * byte-identical whether or not the address has an account, whether the account
 * is Google/Apple-only, and whether it is suspended. The token is NEVER in the
 * response — it only ever reaches the address's inbox — so an attacker who
 * guesses an email learns nothing and gains nothing. Keep it that way: any new
 * early-return here must return `uniformOk(advertised)`, not a distinguishable
 * error, and nothing that varies per ACCOUNT may ever reach the body. (The one
 * channel not equalised is response TIME, and only once email is live: a real
 * account then costs an audit write plus a provider call. Closing that would
 * mean decoy writes and a decoy delay; it is a far weaker signal than a
 * body/status difference, and the rate limits below leave little room to
 * measure it.)
 *
 * DELIVERY DEPENDS ON CONFIGURATION: the provider lives behind @/lib/email and
 * turns on the moment RESEND_API_KEY and EMAIL_FROM are set. Without them this
 * route deliberately mints NOTHING: a token nobody can receive would still
 * invalidate the account's previous outstanding token, so it could only destroy
 * a link an admin had just handed over out of band.
 *
 * The response SAYS which of the two it is, via `delivery` (added — never
 * removed; the 200 and `ok:true` are unchanged, so shipped apps that only read
 * the status keep working). `delivery` is derived from the SERVER's
 * configuration only, never from the address or from whether the seam found an
 * account, so it is byte-identical for every caller and stays outside the
 * enumeration surface. With no provider configured the route answers
 * 'not_configured' before it ever touches the database, and the app tells the
 * member reset-by-email isn't available yet instead of promising mail that will
 * never arrive. Only those two values may ever appear here: the seam's own
 * wider outcome (including 'failed') stays in the audit trail.
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
});

/**
 * The one response this route ever gives on a well-formed request.
 *
 *  - delivery 'sent'           → "if that email has an account, we've sent
 *                                reset instructions" (never "we emailed you").
 *  - delivery 'not_configured' → this server cannot send email at all, for
 *                                anybody. Say that, and point at support.
 */
function uniformOk(delivery: PasswordResetAdvertisedDelivery) {
  return json({ ok: true, delivery }, 200);
}

/**
 * Per-address rate-limit key. Hashed so a burst of requests can't turn the
 * limiter's key set — in memory or in the shared store — into a list of
 * plaintext addresses.
 */
function emailKey(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 32);
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);

    // Per-IP: caps mass enumeration / mail-bombing from one source. A 429 here
    // describes the CALLER's behaviour, so it reveals nothing about accounts.
    // Counted in the shared store when one is configured, so the ceiling holds
    // across instances instead of being multiplied by concurrency; with no
    // store configured it counts per instance exactly as it used to.
    const ipLimited = await rateLimitShared({
      route: 'auth/forgot-password',
      limit: 10,
      windowMs: 15 * 60_000,
      ip,
    });
    if (ipLimited) return ipLimited;

    const parsed = bodySchema.safeParse(await readJson(req));
    // Shape-only rejection: "that isn't an email address" is true regardless of
    // which accounts exist, so it is not an oracle.
    if (!parsed.success) return json({ error: 'invalid' }, 400);

    const email = parsed.data.email.toLowerCase();

    // Config, not account: the SAME value for every caller, so it can be said
    // out loud without leaking who exists.
    const advertised: PasswordResetAdvertisedDelivery = isPasswordResetEmailConfigured()
      ? 'sent'
      : 'not_configured';

    // Per-address: stops one mailbox being flooded from many IPs. Over budget
    // returns the UNIFORM success instead of a 429 — a 429 would tell an
    // attacker that this address was recently asked for, which is a (small)
    // signal about someone else's activity.
    const emailLimited = await rateLimitShared({
      route: 'auth/forgot-password/email',
      limit: 3,
      windowMs: 60 * 60_000,
      ip: emailKey(email),
    });
    if (emailLimited) return uniformOk(advertised);

    // No provider ⇒ nothing to look up, nothing to mint, nothing to audit: the
    // answer is already fully determined. Stopping HERE, before any database
    // work, also removes the one channel this route never equalised — a real
    // account used to cost an extra audit write, so it answered fractionally
    // slower. While email is off there is no such difference at all.
    if (advertised === 'not_configured') return uniformOk(advertised);

    const db = getDb();
    const rows = await db
      .select({
        id: accounts.id,
        email: accounts.email,
        passwordHash: accounts.passwordHash,
        status: accounts.status,
      })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);

    const account = rows[0];

    // No account, or one that can't hold a session anyway (suspended/deleted):
    // silently do nothing. Resetting a suspended account's password would hand
    // back a login the operator deliberately took away.
    if (!account || !canCreateSession(account.status)) return uniformOk(advertised);

    // THE seam. It owns both halves of "send them a link" — minting the token
    // and putting it in an inbox — so a token is never minted that nobody could
    // receive. Its outcome is recorded in the audit trail but NEVER in the
    // response: it is reached only for a real account, so echoing it would be
    // the oracle. The wire answer is `advertised`, which is pure config.
    // A Google/Apple-only account (no password yet) is a valid recipient once
    // email works: control of the mailbox is the same trust anchor those
    // providers vouch for, and it is the only way such a member can add a
    // password.
    const delivery = await deliverPasswordReset(
      db,
      { id: account.id, email: account.email },
      new URL(req.url).origin,
    );

    // Audited so an account takeover attempt leaves a trail (and so support can
    // see why every session died). The actor is the account itself — the
    // request is unauthenticated, so there is no staff actor to attribute.
    await logAudit(
      { id: account.id },
      'account.password_reset_request',
      'account',
      account.id,
      { via: 'self_serve', delivery, hadPassword: account.passwordHash !== null },
      ip,
    );

    return uniformOk(advertised);
  } catch (err) {
    // Never let a failure shape become an oracle either: log server-side, and
    // answer with the same 500 any request could get.
    console.error('API /api/auth/forgot-password error:', err);
    return json({ error: 'internal_error' }, 500);
  }
}
