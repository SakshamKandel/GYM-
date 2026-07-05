import { randomBytes } from 'node:crypto';
import { accounts, admins, sessions } from '@gym/db';
import { type StaffRole, effectiveTier } from '@gym/shared';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from './db';

const SESSION_DAYS = 30;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  tier: 'starter' | 'silver' | 'gold' | 'elite';
}

// The role union now lives in @gym/shared (logic/staffRoles.ts) so the rank
// rules and the role names can never drift apart. Re-exported here so every
// existing `import type { StaffRole } from '@/lib/auth'` keeps working.
export type { StaffRole };

export interface StaffPrincipal {
  user: PublicUser;
  role: StaffRole;
}

/** Opaque 64-char hex token, 30-day expiry, stored server-side. */
export async function createSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await getDb().insert(sessions).values({ token, accountId, expiresAt });
  return token;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Joins session → account; returns null for unknown or expired tokens, or when
 * the account is suspended (status !== 'active') — so suspending an account
 * kills all of its live tokens instantly.
 *
 * The returned `tier` is the EFFECTIVE tier: a paid tier whose tierExpiresAt is
 * in the past collapses to 'starter' here (no cron), so every bearer-authed
 * route that gates on user.tier sees the lapsed value automatically.
 */
export async function userForToken(token: string): Promise<PublicUser | null> {
  const rows = await getDb()
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
    })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .where(
      and(
        eq(sessions.token, token),
        gt(sessions.expiresAt, new Date()),
        eq(accounts.status, 'active'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { tierExpiresAt, ...user } = row;
  return { ...user, tier: effectiveTier(user.tier, tierExpiresAt, new Date()) };
}

/**
 * Resolves a token to a staff principal by joining `admins`. Returns null for
 * non-staff, unknown/expired tokens, or suspended accounts. The account shape
 * mirrors userForToken's PublicUser.
 */
export async function staffForToken(token: string): Promise<StaffPrincipal | null> {
  const rows = await getDb()
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      role: admins.role,
    })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .innerJoin(admins, eq(admins.accountId, accounts.id))
    .where(
      and(
        eq(sessions.token, token),
        gt(sessions.expiresAt, new Date()),
        eq(accounts.status, 'active'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      // Effective tier so a lapsed Elite staff/member sees the collapsed value.
      tier: effectiveTier(row.tier, row.tierExpiresAt, new Date()),
    },
    role: row.role,
  };
}

export async function deleteSession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.token, token));
}
