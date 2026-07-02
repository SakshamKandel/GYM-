import { accounts } from '@gym/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { allowedGoogleClientIds, verifyGoogleIdToken } from '@/lib/google';
import { json, preflight, readJson } from '@/lib/http';

/**
 * POST /api/auth/google — exchange a verified Google ID token for a session.
 * Same contract as /api/auth/login: 200 {token, user}.
 * 503 not_configured until GOOGLE_CLIENT_ID(S) is set;
 * 401 bad_credentials on any verification failure.
 */

export const runtime = 'nodejs';

const bodySchema = z.object({ idToken: z.string().min(1) });

const publicColumns = {
  id: accounts.id,
  email: accounts.email,
  displayName: accounts.displayName,
  tier: accounts.tier,
};

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const allowedAuds = allowedGoogleClientIds();
  if (allowedAuds.length === 0) return json({ error: 'not_configured' }, 503);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const identity = await verifyGoogleIdToken(parsed.data.idToken, allowedAuds);
  if (!identity) return json({ error: 'bad_credentials' }, 401);

  const db = getDb();

  // 1. Returning Google user — matched by stable subject id.
  let user = (
    await db
      .select(publicColumns)
      .from(accounts)
      .where(eq(accounts.googleSub, identity.sub))
      .limit(1)
  )[0];

  // 2. Existing password account with the same (verified) email — link it.
  //    Only when unlinked, so one Google identity can't steal another's row.
  if (!user) {
    user = (
      await db
        .update(accounts)
        .set({ googleSub: identity.sub })
        .where(and(eq(accounts.email, identity.email), isNull(accounts.googleSub)))
        .returning(publicColumns)
    )[0];
  }

  // 3. First sign-in — create a Google-only account (passwordHash stays null).
  if (!user) {
    try {
      user = (
        await db
          .insert(accounts)
          .values({
            email: identity.email,
            googleSub: identity.sub,
            displayName: identity.displayName,
          })
          .returning(publicColumns)
      )[0];
    } catch {
      // Unique race: the same sub/email landed between the checks above and
      // this insert — re-read by sub.
      user = (
        await db
          .select(publicColumns)
          .from(accounts)
          .where(eq(accounts.googleSub, identity.sub))
          .limit(1)
      )[0];
    }
  }

  if (!user) return json({ error: 'bad_credentials' }, 401);

  const token = await createSession(user.id);
  return json({ token, user }, 200);
}
