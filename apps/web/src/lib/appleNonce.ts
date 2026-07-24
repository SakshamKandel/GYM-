import { createHash, randomBytes } from 'node:crypto';
import { appleAuthNonces } from '@gym/db';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { getDb } from './db';

const APPLE_NONCE_TTL_MS = 10 * 60_000;

export function hashAppleAuthNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

/** Create a cryptographically random challenge and store only its digest. */
export async function issueAppleAuthNonce(now: Date = new Date()): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + APPLE_NONCE_TTL_MS);
  const db = getDb();
  await db.insert(appleAuthNonces).values({
    nonceHash: hashAppleAuthNonce(nonce),
    expiresAt,
  });

  // Bounded best-effort cleanup; challenge issuance must not fail because an
  // old-row sweep did. The expiry index keeps this cheap.
  void db
    .delete(appleAuthNonces)
    .where(lt(appleAuthNonces.expiresAt, now))
    .then(
      () => undefined,
      () => undefined,
    );
  return nonce;
}

/** Atomically consume a live challenge. Exactly one concurrent replay wins. */
export async function consumeAppleAuthNonce(
  nonce: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await getDb()
    .update(appleAuthNonces)
    .set({ consumedAt: now })
    .where(
      and(
        eq(appleAuthNonces.nonceHash, hashAppleAuthNonce(nonce)),
        isNull(appleAuthNonces.consumedAt),
        gt(appleAuthNonces.expiresAt, now),
      ),
    )
    .returning({ nonceHash: appleAuthNonces.nonceHash });
  return rows.length === 1;
}
