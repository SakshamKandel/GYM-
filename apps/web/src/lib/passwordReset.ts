import { createHash, randomBytes } from 'node:crypto';
import { passwordResetTokens, type Db } from '@gym/db';
import { and, eq, isNull } from 'drizzle-orm';
import { isEmailConfigured, passwordResetEmail, sendEmail } from './email/index.ts';

/**
 * Password-reset token minting + the email delivery seam.
 *
 * Two routes can START a reset, and they must mint identically so redemption
 * (POST /api/auth/reset-password) stays a single code path:
 *
 *  - POST /api/admin/members/[id]/credentials — an admin mints a link and hands
 *    it over out of band; the plaintext token is returned to the console ONCE.
 *  - POST /api/auth/forgot-password — the member asks for one themselves; the
 *    token is never returned over the wire, it can only reach them by email,
 *    so that path mints only when this server can actually send one.
 *
 * Shape of a token: 32 random bytes hex, stored as SHA-256 only (same posture
 * as the sessions table), 1 hour TTL, single-use, and at most one live token
 * per account.
 */

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** SHA-256 hex — the ONLY form of a reset token that is ever persisted. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface MintedPasswordReset {
  /**
   * The plaintext token. It exists only in this process: hand it to exactly one
   * recipient (the admin's one-time response, or the member's email) and never
   * store or log it — anyone holding it can take the account over.
   */
  token: string;
  expiresAt: Date;
}

/**
 * Issue a fresh single-use reset token for `accountId`.
 *
 * `createdBy` is the staff account that minted it, or null for a self-serve
 * request. Callers are responsible for deciding WHETHER the account may be
 * reset (rank guards, account status); this function only mints.
 */
export async function mintPasswordResetToken(
  db: Db,
  accountId: string,
  createdBy: string | null = null,
): Promise<MintedPasswordReset> {
  // Invalidate any prior outstanding (unused) token so only ONE live reset link
  // can ever exist — marking them used is enough for the redemption CAS to
  // reject them. A newer request therefore supersedes an older link, so a
  // link that leaked but was never redeemed dies as soon as one is re-issued.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(passwordResetTokens.accountId, accountId), isNull(passwordResetTokens.usedAt)),
    );

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await db.insert(passwordResetTokens).values({
    accountId,
    tokenHash: hashResetToken(token),
    expiresAt,
    createdBy,
  });

  return { token, expiresAt };
}

/**
 * The public page that redeems a token: it reads `?token=` and posts it to
 * POST /api/auth/reset-password with the new password.
 */
export function passwordResetUrl(origin: string, token: string): string {
  return `${origin}/reset-password?token=${token}`;
}

/**
 * Same fallback origin as the site metadata (app/layout.tsx, robots.ts,
 * sitemap.ts) so an unset variable still produces a link that resolves.
 */
const FALLBACK_ORIGIN = 'https://gym-xi-tawny.vercel.app';

/**
 * Where a reset link points: the CONFIGURED public address of the site, never
 * the host the request arrived on.
 *
 * A reset link is a bearer credential, and the incoming Host header is caller
 * input. Building the link from it means a request with a forged host produces
 * a link to that host, which is then emailed to the member in our name — one
 * click and the token is in someone else's hands. Reading configuration instead
 * makes the destination a fact about this deployment, so it is the same for
 * every caller no matter what they send.
 */
export function passwordResetOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (!configured) return FALLBACK_ORIGIN;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return FALLBACK_ORIGIN;
    return parsed.origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

/**
 * What this server tells an UNAUTHENTICATED caller about email.
 *
 * Exactly two values, and both are pure configuration, so the answer is
 * byte-identical for every caller:
 *  - 'sent'           → this server can send reset email.
 *  - 'not_configured' → it cannot, for anybody.
 *
 * Shipped mobile builds parse this enum (features/auth/AuthScreen.tsx). Adding
 * a third value here would break them, which is why the seam's own outcome
 * below is a WIDER type that never reaches the wire.
 */
export type PasswordResetAdvertisedDelivery = 'sent' | 'not_configured';

/**
 * What actually happened inside the seam. Superset of the advertised values:
 * 'failed' means email is configured but this attempt did not land. It is
 * recorded in the audit trail and MUST NOT be returned to a caller — it is
 * reached only for a real account, so echoing it would leak that the account
 * exists.
 */
export type PasswordResetDelivery = PasswordResetAdvertisedDelivery | 'failed';

/**
 * Can this server deliver a reset email AT ALL?
 *
 * Pure CONFIGURATION read — it must never look at the address being asked
 * about, and must never touch the database. The answer is echoed to an
 * unauthenticated caller so that the app can stop promising an email it will
 * never receive; if it depended on the account, that echo would rebuild the
 * exact enumeration oracle POST /api/auth/forgot-password exists to avoid.
 *
 * It reads the SAME configuration the sender reads (@/lib/email), so "we say we
 * can send" and "we can actually send" are one decision and cannot drift.
 */
export function isPasswordResetEmailConfigured(): boolean {
  return isEmailConfigured();
}

/** Just enough of an account to address the email to. */
export interface PasswordResetRecipient {
  id: string;
  email: string;
}

/**
 * ══ DELIVERY SEAM — mint a reset link and put it in the member's inbox ══════
 *
 * It owns BOTH halves on purpose, because minting is not free: it invalidates
 * whatever token the account already had. On a server with no email
 * configuration a self-serve mint could only ever destroy a still-valid link an
 * admin handed over out of band, and could never replace it. So "can we
 * deliver?" and "do we mint?" are one decision, made here, and they cannot
 * drift apart.
 *
 * Every outcome is NON-fatal. Callers must answer uniformly whatever comes
 * back, otherwise the response would leak whether an account exists.
 *
 * Nothing here is ever logged: an address is personal data and a reset URL is a
 * bearer credential. The provider (@/lib/email) holds the same line.
 *
 * Deliberately NOT routed through @/lib/notify: that channel is push + the
 * in-app inbox for a signed-in account, and someone who has lost their password
 * cannot sign in to read it. Email is the only channel that reaches them.
 */
export async function deliverPasswordReset(
  db: Db,
  account: PasswordResetRecipient,
): Promise<PasswordResetDelivery> {
  if (!isEmailConfigured()) {
    // Names variables only, never a value, and says what an operator can do
    // about it. No address and no token exist at this point anyway.
    console.warn(
      '[password-reset] email is not configured, so no message was sent and no ' +
        'token was minted. Set RESEND_API_KEY and EMAIL_FROM to turn it on. ' +
        'Until then, reset links can only be issued by an admin from the member ' +
        'credentials tool.',
    );
    return 'not_configured';
  }

  const minted = await mintPasswordResetToken(db, account.id, null);
  // Configured address, not the request's host — see passwordResetOrigin().
  const body = passwordResetEmail(
    passwordResetUrl(passwordResetOrigin(), minted.token),
    minted.expiresAt,
  );

  const dispatch = await sendEmail({ to: account.email, ...body });

  // Anything other than "accepted" is a failure from here, including the
  // 'not_configured' that is only reachable if the configuration vanished
  // mid-request: a token was minted by that point, so "nothing happened" would
  // be untrue. Worth auditing, because a mint also retires whatever link an
  // admin had issued for this account. The member can simply ask again.
  return dispatch === 'sent' ? 'sent' : 'failed';
}
