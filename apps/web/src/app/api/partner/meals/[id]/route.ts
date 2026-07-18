import { meals } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Partner menu CRUD — item endpoints (§3). Every write is scoped
 * `WHERE id AND partnerId=<caller's own>` so a cross-restaurant edit matches 0
 * rows → 404 (§2 threat: cross-restaurant meal edit). DELETE is a SOFT delete
 * (`isDeleted=true`) so historical order-item snapshots keep resolving.
 */

const macroInt = z.number().int().min(0).max(100_000);
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000),
    imageUrl: z.string().trim().max(2000).nullable(),
    kcal: macroInt,
    proteinG: macroInt,
    carbsG: macroInt,
    fatG: macroInt,
    fiberG: macroInt.nullable(),
    sugarG: macroInt.nullable(),
    dietType: z.enum(['veg', 'non_veg', 'egg']),
    goalTags: z.array(z.enum(['cutting', 'bulking', 'balanced'])).max(3),
    priceMinor: z.number().int().min(0).max(100_000_000),
    currency: z.enum(['NPR', 'USD']),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .partial();

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  if (Object.keys(parsed.data).length === 0) return json({ error: 'no_fields' }, 400);

  const [meal] = await getDb()
    .update(meals)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(meals.id, id), eq(meals.partnerId, partnerId), eq(meals.isDeleted, false)))
    .returning();
  if (!meal) return json({ error: 'not_found' }, 404);

  return json({ meal }, 200);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const { id } = await ctx.params;
  const [meal] = await getDb()
    .update(meals)
    .set({ isDeleted: true, isActive: false, updatedAt: new Date() })
    .where(and(eq(meals.id, id), eq(meals.partnerId, partnerId), eq(meals.isDeleted, false)))
    .returning({ id: meals.id });
  if (!meal) return json({ error: 'not_found' }, 404);

  return json({ ok: true }, 200);
}
