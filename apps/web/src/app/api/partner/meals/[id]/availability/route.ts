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
 *
 * Sold-out (`meal_availability.soldOut`) is the per-slot "we've run out today"
 * flag, and it is NOT part of the schedule the replace rewrites: the POST
 * carries every existing flag over to the rebuilt rows, and PATCH is the writer
 * that toggles one slot. Without the carry-over, saving the schedule silently
 * put a sold-out dish back on sale.
 */

const slotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  window: z.enum(['lunch', 'dinner']),
});

const bodySchema = z.object({
  slots: z.array(slotSchema).max(14),
});

/** One slot toggle — the partner-scoped sold-out writer. */
const patchSchema = slotSchema.extend({ soldOut: z.boolean() });

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
const WINDOWS = ['lunch', 'dinner'] as const;

function slotKey(dayOfWeek: number, window: string): string {
  return `${dayOfWeek}|${window}`;
}

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

  // Read the live sold-out flags BEFORE the replace so a schedule save never
  // silently puts a sold-out slot back on sale. Only slots that survive the
  // replace keep their flag; a slot the partner removed is gone either way.
  const existing = await db
    .select({
      dayOfWeek: mealAvailability.dayOfWeek,
      window: mealAvailability.window,
      soldOut: mealAvailability.soldOut,
    })
    .from(mealAvailability)
    .where(eq(mealAvailability.mealId, id));
  const soldOutKeys = new Set(
    existing.filter((row) => row.soldOut).map((row) => slotKey(row.dayOfWeek, row.window)),
  );

  await db.delete(mealAvailability).where(eq(mealAvailability.mealId, id));
  const saved = slots.map((s) => ({
    mealId: id,
    dayOfWeek: s.dayOfWeek,
    window: s.window,
    soldOut: soldOutKeys.has(slotKey(s.dayOfWeek, s.window)),
  }));
  if (saved.length > 0) {
    await db
      .insert(mealAvailability)
      .values(saved)
      .onConflictDoNothing({
        target: [mealAvailability.mealId, mealAvailability.dayOfWeek, mealAvailability.window],
      });
  }

  // `slots` keeps its historical shape; `soldOut` rides along additively.
  return json(
    {
      ok: true,
      slots: saved.map((s) => ({ dayOfWeek: s.dayOfWeek, window: s.window, soldOut: s.soldOut })),
    },
    200,
  );
}

/**
 * Toggle ONE slot's sold-out flag. Partner-scoped exactly like POST.
 *
 * A meal with no availability rows is "always available", so there is no row to
 * flag. Marking such a slot sold-out first writes the full 7×2 grid with every
 * flag off — semantically identical availability (a meal listed for every slot
 * is orderable in every slot) — and then flags the one slot, so the partner
 * never has to build a schedule just to say "we ran out of today's lunch".
 * Clearing a flag that cannot exist is a no-op, never an error.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { dayOfWeek, window, soldOut } = parsed.data;

  const db = getDb();

  const [meal] = await db
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.id, id), eq(meals.partnerId, partnerId), eq(meals.isDeleted, false)))
    .limit(1);
  if (!meal) return json({ error: 'not_found' }, 404);

  const existing = await db
    .select({ dayOfWeek: mealAvailability.dayOfWeek, window: mealAvailability.window })
    .from(mealAvailability)
    .where(eq(mealAvailability.mealId, id));

  if (existing.length === 0) {
    if (!soldOut) return json({ ok: true, dayOfWeek, window, soldOut: false }, 200);
    await db
      .insert(mealAvailability)
      .values(
        DAYS_OF_WEEK.flatMap((day) =>
          WINDOWS.map((slotWindow) => ({
            mealId: id,
            dayOfWeek: day,
            window: slotWindow,
            soldOut: false,
          })),
        ),
      )
      .onConflictDoNothing({
        target: [mealAvailability.mealId, mealAvailability.dayOfWeek, mealAvailability.window],
      });
  } else if (
    !existing.some((row) => row.dayOfWeek === dayOfWeek && row.window === window)
  ) {
    // The dish isn't on the menu for that slot at all — nothing to sell out.
    return json({ error: 'slot_not_available' }, 409);
  }

  const updated = await db
    .update(mealAvailability)
    .set({ soldOut })
    .where(
      and(
        eq(mealAvailability.mealId, id),
        eq(mealAvailability.dayOfWeek, dayOfWeek),
        eq(mealAvailability.window, window),
      ),
    )
    .returning({ id: mealAvailability.id });
  if (updated.length === 0) return json({ error: 'slot_not_available' }, 409);

  return json({ ok: true, dayOfWeek, window, soldOut }, 200);
}
