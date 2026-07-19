import { notifications } from '@gym/db';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { callerAccountId } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/[id]/read — mark one notification read (Pack B / WP-2).
 * Scoped to the caller's own account: the UPDATE filters on accountId, so a
 * mismatched id (someone else's, or unknown) simply matches 0 rows → 404, never
 * leaking or mutating another account's row (§7.2-S8). Idempotent — re-marking an
 * already-read row returns ok.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const accountId = await callerAccountId(req);
  if (!accountId) return json({ error: 'unauthorized' }, 401);
  const { id } = await ctx.params;

  const updated = await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.accountId, accountId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  if (updated.length === 0) {
    // Either not the caller's row (or unknown), or already read. Distinguish so
    // an idempotent re-tap on an already-read row succeeds rather than 404s.
    const exists = await getDb()
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.accountId, accountId)))
      .limit(1);
    if (exists.length === 0) return json({ error: 'not_found' }, 404);
  }

  return json({ ok: true }, 200);
}
