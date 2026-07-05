import { gamificationProfiles } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { runAwardEngineOrThrow } from '@/lib/gamification';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member gamification profile.
 *
 *  - GET → runs the award engine inline (cheap, idempotent: every insert it
 *    does is onConflictDoNothing), which also auto-consumes Rest Shields for
 *    any newly-missed week, then returns the full profile/streak/shields/
 *    badges snapshot the mobile profile screen and streak chip render from.
 *  - PATCH {weeklyTargetDays: 2..7} → updates the account's weekly session
 *    target (mirrors the mobile onboarding `daysPerWeek` setting server-side
 *    so shield/streak computation uses the same number as the client).
 */

const patchSchema = z.object({
  weeklyTargetDays: z.number().int().min(2).max(7),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // Uses the throwing variant so a transient failure returns a real HTTP
  // error instead of a fabricated all-zero snapshot served as 200 — mobile
  // keeps its last-known local/cached state on a non-2xx response rather
  // than overwriting a paying user's real XP/rank/shields with zeroes.
  let result;
  try {
    result = await runAwardEngineOrThrow(user.id);
  } catch (err) {
    console.error('[gamification] GET /api/gamification failed', err);
    return json({ error: 'unavailable' }, 503);
  }

  return json(
    {
      profile: result.profile,
      streak: result.streak,
      shields: result.shields,
      badges: result.badges,
    },
    200,
  );
}

export async function PATCH(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { weeklyTargetDays } = parsed.data;

  const db = getDb();
  // Ensure a profile row exists (first-touch), then set the target.
  await db.insert(gamificationProfiles).values({ accountId: user.id, weeklyTargetDays }).onConflictDoNothing({
    target: gamificationProfiles.accountId,
  });
  await db
    .update(gamificationProfiles)
    .set({ weeklyTargetDays, updatedAt: new Date() })
    .where(and(eq(gamificationProfiles.accountId, user.id)));

  return json({ ok: true, weeklyTargetDays }, 200);
}
