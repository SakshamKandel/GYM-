import { accounts, awardedBadges } from '@gym/db';
import { BADGE_CATALOG } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin gamification oversight — awarded-badge browser (gap build P2-17).
 *
 *  - GET ?accountId=&badgeId= → awarded_badges rows (either filter is
 *    optional; combined they narrow to one account+badge pair), newest
 *    first, joined to the account's identity and the catalog's display name
 *    (catalog badges only — `challenge:<id>` / legacy retired ids render
 *    with their raw badgeId since they have no BADGE_CATALOG entry).
 *    Capped at 200 rows; the console is expected to search by account or
 *    badge id rather than browse the whole table.
 *
 * Revocation lives in [id]/route.ts (DELETE). Guarded by
 * requirePermission('gamification.manage').
 */

const CATALOG_NAME_BY_ID = new Map(BADGE_CATALOG.map((b) => [b.id, b.name]));

const listQuerySchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  badgeId: z.string().trim().min(1).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'gamification.manage');
  if (principal instanceof Response) return principal;

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    accountId: url.searchParams.get('accountId') ?? undefined,
    badgeId: url.searchParams.get('badgeId') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { accountId, badgeId } = parsed.data;

  const conditions = [
    accountId ? eq(awardedBadges.accountId, accountId) : undefined,
    badgeId ? eq(awardedBadges.badgeId, badgeId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const db = getDb();
  const rows = await db
    .select({
      id: awardedBadges.id,
      accountId: awardedBadges.accountId,
      accountEmail: accounts.email,
      accountName: accounts.displayName,
      badgeId: awardedBadges.badgeId,
      status: awardedBadges.status,
      earnedAt: awardedBadges.earnedAt,
    })
    .from(awardedBadges)
    .innerJoin(accounts, eq(accounts.id, awardedBadges.accountId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(awardedBadges.earnedAt))
    .limit(200);

  return json(
    {
      badges: rows.map((r) => ({ ...r, badgeName: CATALOG_NAME_BY_ID.get(r.badgeId) ?? r.badgeId })),
    },
    200,
  );
}
