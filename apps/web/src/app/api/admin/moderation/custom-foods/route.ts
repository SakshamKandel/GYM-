import { accounts, memberFoods } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — member_foods moderation (ADMIN-MASTER-PLAN §3 P1-9, the
 * third queue alongside milestones + progress photos).
 *
 * `moderation.manage` has always covered member-authored custom foods on
 * paper, and both mobile staff screens already render a "Custom foods" tab —
 * but no route existed, so those tabs dead-ended on a client-side stub. This
 * is the missing rail.
 *
 *  - GET → the 200 most recently touched LIVE custom foods across every
 *    account (tombstoned rows are excluded — see the sibling [id] route for
 *    why removal is a soft delete), joined to the authoring member's identity.
 *
 * member_foods holds ONLY member-authored rows; Open Food Facts / USDA
 * results are replaceable device caches and never land here, so every row in
 * this queue is genuinely user-generated content.
 *
 * Guarded by requirePermission('moderation.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const limited = rateLimit({
    route: 'admin/moderation/custom-foods:list',
    limit: 60,
    windowMs: 60 * 1000,
    accountId: principal.id,
  });
  if (limited) return limited;

  const rows = await getDb()
    .select({
      id: memberFoods.id,
      name: memberFoods.name,
      brand: memberFoods.brand,
      barcode: memberFoods.barcode,
      kcalPer100: memberFoods.kcalPer100,
      proteinPer100: memberFoods.proteinPer100,
      carbsPer100: memberFoods.carbsPer100,
      fatPer100: memberFoods.fatPer100,
      servingGrams: memberFoods.servingGrams,
      servingLabel: memberFoods.servingLabel,
      // The member's own device clock at authoring time — the closest thing
      // this sync-owned table has to a createdAt.
      createdAt: memberFoods.clientChangedAt,
      updatedAt: memberFoods.updatedAt,
      account: { id: accounts.id, email: accounts.email, displayName: accounts.displayName },
    })
    .from(memberFoods)
    .innerJoin(accounts, eq(accounts.id, memberFoods.accountId))
    .where(eq(memberFoods.deleted, false))
    .orderBy(desc(memberFoods.updatedAt), desc(memberFoods.id))
    .limit(200);

  const foods = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return json({ foods }, 200);
}
