import { randomBytes } from 'node:crypto';
import { accounts, sessions } from '@gym/db';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from './db';

const SESSION_DAYS = 30;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  tier: 'starter' | 'silver' | 'gold' | 'elite';
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

/** Joins session → account; returns null for unknown or expired tokens. */
export async function userForToken(token: string): Promise<PublicUser | null> {
  const rows = await getDb()
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
    })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.token, token));
}
