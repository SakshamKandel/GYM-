import { accounts } from '@gym/db';
import { appleAuthRequestSchema, effectiveTier, maskPii } from '@gym/shared';
import { and, eq, isNull } from 'drizzle-orm';
import {
  allowedAppleClientIds,
  AppleVerificationUnavailable,
  decideAppleEmailCollision,
  displayNameForNewAppleAccount,
  verifyAppleIdToken,
} from '@/lib/apple';
import { createSession } from '@/lib/auth';
import { consumeAppleAuthNonce } from '@/lib/appleNonce';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { wireReferralsForNewAccount } from '@/lib/promoEconomy';
import { clientIp, rateLimitShared } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const accountColumns = {
  id: accounts.id,
  email: accounts.email,
  displayName: accounts.displayName,
  tier: accounts.tier,
  tierExpiresAt: accounts.tierExpiresAt,
  status: accounts.status,
};

export function OPTIONS() {
  return preflight();
}

/** Exchange a cryptographically verified Apple identity token for an app session. */
export async function POST(req: Request) {
  // Same 10/min/IP ceiling as the other sign-in routes, counted in the shared
  // store when one is configured (per instance when none is) so serverless
  // concurrency can't multiply it. The link branch checks a password.
  const limited = await rateLimitShared({
    route: 'auth/apple',
    limit: 10,
    windowMs: 60_000,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const allowedAudiences = allowedAppleClientIds();
  if (allowedAudiences.length === 0) return json({ error: 'not_configured' }, 503);

  const parsed = appleAuthRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  let identity;
  try {
    identity = await verifyAppleIdToken(
      parsed.data.identityToken,
      allowedAudiences,
      parsed.data.nonce,
    );
  } catch (error: unknown) {
    if (error instanceof AppleVerificationUnavailable) {
      return json({ error: 'auth_unavailable' }, 503);
    }
    return json({ error: 'bad_credentials' }, 401);
  }
  if (!identity) return json({ error: 'bad_credentials' }, 401);

  const db = getDb();
  // Captured before the closure: TypeScript does not carry the `parsed.success`
  // narrowing into a function body declared after it.
  const requestNonce = parsed.data.nonce;
  let nonceConsumed = false;
  async function consumeNonce(): Promise<Response | null> {
    if (nonceConsumed) return null;
    try {
      if (!(await consumeAppleAuthNonce(requestNonce))) {
        return json({ error: 'bad_credentials' }, 401);
      }
      nonceConsumed = true;
      return null;
    } catch {
      return json({ error: 'auth_unavailable' }, 503);
    }
  }

  // 1. Returning member: stable Apple subject is the account key. Client name
  // and token email never overwrite an established account.
  let user = (
    await db
      .select(accountColumns)
      .from(accounts)
      .where(eq(accounts.appleSub, identity.sub))
      .limit(1)
  )[0];
  if (user?.status === 'suspended') return json({ error: 'bad_credentials' }, 401);

  // 2. A first-time subject needs a verified token email to create or link.
  // Managed Apple identities without an email can still return by sub above,
  // but cannot safely create an email-addressed account.
  if (!user && identity.email === null) return json({ error: 'bad_credentials' }, 401);

  if (!user && identity.email !== null) {
    const existing = (
      await db
        .select({
          id: accounts.id,
          passwordHash: accounts.passwordHash,
          googleSub: accounts.googleSub,
          appleSub: accounts.appleSub,
          status: accounts.status,
        })
        .from(accounts)
        .where(eq(accounts.email, identity.email))
        .limit(1)
    )[0];

    if (existing) {
      const decision = decideAppleEmailCollision(existing, parsed.data.password !== undefined);
      if (decision === 'reject') return json({ error: 'bad_credentials' }, 401);
      if (decision === 'require_password') return json({ error: 'link_required' }, 409);
      if (decision === 'verify_password') {
        if (
          existing.passwordHash === null ||
          parsed.data.password === undefined ||
          !(await verifyPassword(parsed.data.password, existing.passwordHash))
        ) {
          return json({ error: 'bad_credentials' }, 401);
        }
      }

      // Do not consume on link_required: the client must retry this exact
      // signed token + nonce after proving the existing account password.
      const nonceError = await consumeNonce();
      if (nonceError) return nonceError;

      try {
        user = (
          await db
            .update(accounts)
            .set({ appleSub: identity.sub })
            .where(
              and(
                eq(accounts.id, existing.id),
                eq(accounts.status, 'active'),
                isNull(accounts.appleSub),
              ),
            )
            .returning(accountColumns)
        )[0];
      } catch {
        // A concurrent request may have linked this exact Apple subject.
        user = (
          await db
            .select(accountColumns)
            .from(accounts)
            .where(eq(accounts.appleSub, identity.sub))
            .limit(1)
        )[0];
      }
      if (!user || user.status !== 'active') {
        return json({ error: 'bad_credentials' }, 401);
      }
    }
  }

  // 3. First sign-in: identity is token-derived; the one-time name is merely
  // validated/sanitised display metadata and never participates in matching.
  let createdNewAccount = false;
  if (!user && identity.email !== null) {
    const nonceError = await consumeNonce();
    if (nonceError) return nonceError;
    try {
      user = (
        await db
          .insert(accounts)
          .values({
            email: identity.email,
            appleSub: identity.sub,
            // Masked on the way in: the name reaches every coach the member
            // works with, and the one-time name Apple hands over is whatever
            // the member typed. Same rule as /api/auth/register. The length
            // sanitising inside the helper still runs on the raw name.
            displayName: maskPii(
              displayNameForNewAppleAccount(parsed.data.displayName, identity.email),
            ),
          })
          .returning(accountColumns)
      )[0];
      createdNewAccount = user !== undefined;
    } catch {
      user = (
        await db
          .select(accountColumns)
          .from(accounts)
          .where(eq(accounts.appleSub, identity.sub))
          .limit(1)
      )[0];
    }
  }

  if (!user || user.status !== 'active') return json({ error: 'bad_credentials' }, 401);

  // Returning-sub path has not mutated anything yet; consume immediately
  // before issuing the app session. Linking/creation already consumed above.
  const nonceError = await consumeNonce();
  if (nonceError) return nonceError;

  if (createdNewAccount) await wireReferralsForNewAccount(user.id, user.email);

  const token = await createSession(user.id);
  const { tierExpiresAt, status: _status, ...publicUser } = user;
  return json(
    {
      token,
      user: {
        ...publicUser,
        tier: effectiveTier(user.tier, tierExpiresAt, new Date()),
      },
    },
    200,
  );
}
