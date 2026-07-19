import { notifications } from '@gym/db';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { callerAccountId } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/read-all — mark every unread notification of the
 * caller read in one write (Pack B / WP-2). Account-scoped; returns how many
 * rows flipped so the client can zero its badge without a refetch.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const accountId = await callerAccountId(req);
  if (!accountId) return json({ error: 'unauthorized' }, 401);

  const updated = await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.accountId, accountId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });

  return json({ ok: true, updated: updated.length }, 200);
}
