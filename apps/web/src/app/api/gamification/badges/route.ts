import { awardedBadges, coachChallenges } from '@gym/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member badges list. The catalog itself (44 launch badges, names, icons,
 * families) lives client-side in @gym/shared — this route only returns the
 * caller's earned rows plus display titles for any `challenge:<id>` badge ids
 * (the catalog has no entry for those, they're minted server-side per coach
 * challenge).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = getDb();

  const rows = await db
    .select({
      badgeId: awardedBadges.badgeId,
      status: awardedBadges.status,
      earnedAt: awardedBadges.earnedAt,
      verifiedAt: awardedBadges.verifiedAt,
    })
    .from(awardedBadges)
    .where(eq(awardedBadges.accountId, user.id))
    .orderBy(desc(awardedBadges.earnedAt));

  const challengeBadgeIds = rows.map((r) => r.badgeId).filter((id) => id.startsWith('challenge:'));
  const challengeTitles: Record<string, string> = {};
  if (challengeBadgeIds.length > 0) {
    const ids = challengeBadgeIds.map((id) => id.slice('challenge:'.length));
    const titleRows = await db
      .select({ id: coachChallenges.id, title: coachChallenges.title })
      .from(coachChallenges)
      .where(inArray(coachChallenges.id, ids));
    for (const t of titleRows) challengeTitles[t.id] = t.title;
  }

  return json(
    {
      badges: rows.map((r) => ({
        badgeId: r.badgeId,
        status: r.status,
        earnedAt: r.earnedAt,
        verifiedAt: r.verifiedAt ?? null,
      })),
      challengeTitles,
    },
    200,
  );
}
