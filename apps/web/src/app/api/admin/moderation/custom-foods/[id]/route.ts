import { memberFoods } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — moderator removal of a member_foods row.
 *
 * SOFT delete, unlike its milestone/progress-photo siblings. member_foods is
 * one of the six offline-first entities behind POST /api/sync/member-data, and
 * that sync is pull-by-tombstone: the device only learns a record is gone when
 * it pulls a row carrying `deleted = true`. A hard `DELETE FROM member_foods`
 * would vanish server-side and the member's phone would keep — and keep
 * offering — the food forever, because a missing row produces no change to
 * pull. So the removal is written as the same tombstone a member's own delete
 * produces:
 *
 *   deleted        → true            (sqlite.ts drops the local `foods` row on
 *                                     an incoming food change with deleted set)
 *   updatedAt      → now             (the keyset cursor column — this is what
 *                                     pushes the tombstone into the device's
 *                                     next pull page; without the bump the row
 *                                     sits behind the cursor and never ships)
 *   clientChangedAt→ now  ┐ the (clientChangedAt, mutationId) last-writer-wins
 *   mutationId     → new  ┘ tuple. Bumping BOTH is what makes the removal beat
 *                           an edit the member queued offline BEFORE the
 *                           moderation call: both the server's `incomingWins`
 *                           guard and the device's compareMemberDataVersions
 *                           check compare that tuple, so a stale queued
 *                           mutation now loses and can't resurrect the food.
 *                           (A genuinely NEWER member edit still wins — that is
 *                           LWW working as designed, and re-adding the food on
 *                           the phone mints a fresh id anyway.)
 *
 * Past food logs are unaffected: member_food_logs denormalises foodName and the
 * macros at log time, so a member's diary history stays intact and correct.
 *
 * The row key is composite (accountId, id). `id` is a client-minted uuid so it
 * is unique in practice, but this route does not assume that: pass
 * `?accountId=` to address one row exactly (both first-party callers do), and
 * without it an ambiguous id is refused rather than guessed at.
 *
 * Guarded by requirePermission('moderation.manage'), audited on success.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const limited = rateLimit({
    route: 'admin/moderation/custom-foods:remove',
    limit: 60,
    windowMs: 60 * 1000,
    accountId: principal.id,
  });
  if (limited) return limited;

  const { id } = await params;
  const accountId = new URL(req.url).searchParams.get('accountId');

  const db = getDb();
  const rows = await db
    .select({
      id: memberFoods.id,
      accountId: memberFoods.accountId,
      name: memberFoods.name,
      brand: memberFoods.brand,
      deleted: memberFoods.deleted,
    })
    .from(memberFoods)
    .where(
      accountId
        ? and(eq(memberFoods.id, id), eq(memberFoods.accountId, accountId))
        : eq(memberFoods.id, id),
    )
    .limit(2);

  const [row, second] = rows;
  if (!row) return json({ error: 'not_found' }, 404);
  // Two accounts minted the same food id — refuse rather than remove the wrong
  // member's food. The caller can retry with ?accountId= to disambiguate.
  if (second) return json({ error: 'ambiguous' }, 409);
  // Already tombstoned (double-tap, or a retry after a dropped response).
  // Idempotent success — re-stamping would only re-broadcast the same removal.
  if (row.deleted) return json({ ok: true }, 200);

  const now = new Date();
  await db
    .update(memberFoods)
    .set({
      deleted: true,
      clientChangedAt: now,
      // Must be fresh: member_foods_account_mutation is UNIQUE per account.
      mutationId: `moderation-${crypto.randomUUID()}`,
      updatedAt: now,
    })
    .where(and(eq(memberFoods.accountId, row.accountId), eq(memberFoods.id, row.id)));

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'moderation.custom_food.remove',
    'account',
    row.accountId,
    { foodId: row.id, name: row.name, brand: row.brand },
    ip,
  );

  return json({ ok: true }, 200);
}
