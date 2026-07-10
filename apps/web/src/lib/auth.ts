import { createHash, randomBytes } from 'node:crypto';
import { accounts, admins, sessions } from '@gym/db';
import { type StaffRole, effectiveTier } from '@gym/shared';
import { and, eq, gt, lt } from 'drizzle-orm';
import { getDb } from './db';

const SESSION_DAYS = 30;

/**
 * The sessions table stores only a SHA-256 hash of the bearer token, never the
 * token itself. The plaintext is handed to the client once (in createSession)
 * and re-hashed on every request before the lookup — so a read-only leak of the
 * sessions table (SQL-injection read, stale backup, compromised replica) yields
 * only hashes, which are useless as `Authorization: Bearer <token>`.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Session hygiene: expired rows are invisible to the auth queries below (they
 * filter on expires_at > now) but pile up forever. Opportunistically sweep
 * them at most once per instance per hour — fire-and-forget, so the sweep can
 * never add latency or failure to an auth call.
 */
const SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastSessionPruneAt = 0;

function maybePruneExpiredSessions(): void {
  const now = Date.now();
  if (now - lastSessionPruneAt < SESSION_PRUNE_INTERVAL_MS) return;
  lastSessionPruneAt = now;
  void getDb()
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date(now)))
    .then(
      () => undefined,
      () => undefined, // best-effort — next hour's sweep retries
    );
}

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
  await getDb()
    .insert(sessions)
    .values({ token: hashToken(token), accountId, expiresAt });
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
  maybePruneExpiredSessions();
  const tokenHash = hashToken(token);
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
        eq(sessions.token, tokenHash),
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
  maybePruneExpiredSessions();
  const tokenHash = hashToken(token);
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
        eq(sessions.token, tokenHash),
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
  await getDb().delete(sessions).where(eq(sessions.token, hashToken(token)));
}
