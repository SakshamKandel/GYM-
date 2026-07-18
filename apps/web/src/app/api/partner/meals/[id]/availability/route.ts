import { mealAvailability, meals } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Replace a meal's availability slots (§3). A meal with NO slots is treated as
 * always-available (partner opt-in narrowing), so an empty `slots` array clears
 * all restrictions. The meal must belong to the caller's own partner
 * (`WHERE id AND partnerId`) or the whole call is a 404 — no cross-restaurant
 * availability edits.
 *
 * neon-http has no transactions, so this is a delete-then-insert replace. The
 * unique index (mealId,dayOfWeek,window) + onConflictDoNothing make it safe
 * against duplicate slots in the payload and idempotent under a retry.
 */

const bodySchema = z.object({
  slots: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        window: z.enum(['lunch', 'dinner']),
      }),
    )
    .max(14),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { slots } = parsed.data;

  const db = getDb();

  // Ownership check — the meal must be the caller's own, live item.
  const [meal] = await db
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.id, id), eq(meals.partnerId, partnerId), eq(meals.isDeleted, false)))
    .limit(1);
  if (!meal) return json({ error: 'not_found' }, 404);

  await db.delete(mealAvailability).where(eq(mealAvailability.mealId, id));
  if (slots.length > 0) {
    await db
      .insert(mealAvailability)
      .values(slots.map((s) => ({ mealId: id, dayOfWeek: s.dayOfWeek, window: s.window })))
      .onConflictDoNothing({
        target: [mealAvailability.mealId, mealAvailability.dayOfWeek, mealAvailability.window],
      });
  }

  return json({ ok: true, slots }, 200);
}
