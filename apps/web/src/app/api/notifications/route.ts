import { notifications } from '@gym/db';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { callerAccountId } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications — the caller's own notification center (Pack B / WP-2).
 * Account-scoped (a member or a staff account reads only its OWN rows, §7.2-S8),
 * newest-first, PAGINATED (`?limit&offset`, P1 — the `notifications_account_created`
 * index covers the sort). Also returns the unread badge count in one round-trip.
 *
 * Shape (frozen — WP-14 mobile center consumes it):
 *   { notifications: Array<{ id, event, title, body, data, readAt, createdAt }>,
 *     unreadCount: number, nextOffset: number | null }
 */

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function parseIntOr(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const accountId = await callerAccountId(req);
  if (!accountId) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseIntOr(url.searchParams.get('limit'), DEFAULT_LIMIT)));
  const offset = Math.max(0, parseIntOr(url.searchParams.get('offset'), 0));
  const db = getDb();

  // Over-fetch by one to detect whether another page exists.
  const rows = await db
    .select({
      id: notifications.id,
      event: notifications.event,
      title: notifications.title,
      body: notifications.body,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.accountId, accountId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const unreadRows = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.accountId, accountId), isNull(notifications.readAt)));
  const unreadCount = unreadRows[0]?.n ?? 0;

  return json(
    {
      notifications: page.map((r) => ({
        id: r.id,
        event: r.event,
        title: r.title,
        body: r.body,
        data: r.data ?? null,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })),
      unreadCount,
      nextOffset: hasMore ? offset + limit : null,
    },
    200,
  );
}
