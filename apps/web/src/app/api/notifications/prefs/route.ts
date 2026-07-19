import { type NotificationPrefCategories, notificationPrefs } from '@gym/db';
import { NOTIFICATION_CATEGORIES } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { callerAccountId } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/notifications/prefs — per-account notification preferences +
 * quiet hours (Pack B / WP-2; E3 reusable consent store). Default all-on: a
 * missing row (or a missing category key) is treated as enabled by `notify()`,
 * so a brand-new account gets every notification until it opts out here.
 *
 * GET  → { categories, quietHoursStart, quietHoursEnd, availableCategories }
 * PUT  → merge-upsert of any provided fields; returns the persisted state.
 */

const KNOWN_CATEGORIES = new Set<string>(NOTIFICATION_CATEGORIES);

/** minutes-of-day (KTM), 0-1439, or null for "no quiet window". */
const minuteOfDay = z.number().int().min(0).max(1439).nullable();

const putSchema = z.object({
  categories: z.record(z.string(), z.object({ push: z.boolean() })).optional(),
  quietHoursStart: minuteOfDay.optional(),
  quietHoursEnd: minuteOfDay.optional(),
});

export function OPTIONS() {
  return preflight();
}

async function loadRow(accountId: string) {
  const rows = await getDb()
    .select({
      categories: notificationPrefs.categories,
      quietHoursStart: notificationPrefs.quietHoursStart,
      quietHoursEnd: notificationPrefs.quietHoursEnd,
    })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.accountId, accountId))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(req: Request) {
  const accountId = await callerAccountId(req);
  if (!accountId) return json({ error: 'unauthorized' }, 401);
  const row = await loadRow(accountId);
  return json(
    {
      categories: row?.categories ?? {},
      quietHoursStart: row?.quietHoursStart ?? null,
      quietHoursEnd: row?.quietHoursEnd ?? null,
      availableCategories: [...NOTIFICATION_CATEGORIES],
    },
    200,
  );
}

export async function PUT(req: Request) {
  const accountId = await callerAccountId(req);
  if (!accountId) return json({ error: 'unauthorized' }, 401);

  const parsed = putSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const body = parsed.data;

  const existing = await loadRow(accountId);

  // Merge: a provided `categories` map REPLACES the stored one (the UI sends the
  // full toggle state), but unknown keys are dropped so a client can never seed
  // arbitrary jsonb. Absent fields keep their stored value.
  let categories: NotificationPrefCategories = existing?.categories ?? {};
  if (body.categories) {
    const clean: NotificationPrefCategories = {};
    for (const [key, value] of Object.entries(body.categories)) {
      if (KNOWN_CATEGORIES.has(key)) clean[key] = { push: value.push };
    }
    categories = clean;
  }
  const quietHoursStart =
    body.quietHoursStart !== undefined ? body.quietHoursStart : (existing?.quietHoursStart ?? null);
  const quietHoursEnd =
    body.quietHoursEnd !== undefined ? body.quietHoursEnd : (existing?.quietHoursEnd ?? null);

  const now = new Date();
  await getDb()
    .insert(notificationPrefs)
    .values({ accountId, categories, quietHoursStart, quietHoursEnd, updatedAt: now })
    .onConflictDoUpdate({
      target: notificationPrefs.accountId,
      set: { categories, quietHoursStart, quietHoursEnd, updatedAt: now },
    });

  return json({ categories, quietHoursStart, quietHoursEnd }, 200);
}
