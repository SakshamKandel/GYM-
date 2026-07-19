import { mealPartners, meals } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { loadPartnerMenu } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Partner menu CRUD — collection endpoints (§3). GET lists the caller's OWN
 * non-deleted menu (+ availability); POST creates a new item under the caller's
 * `partnerId` (from requirePartner, never the body). Macros/price are integers;
 * price is minor units in the item's own currency (server stores exactly what the
 * partner sets — the member order route re-resolves it server-side at order time).
 */

const macroInt = z.number().int().min(0).max(100_000);
const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  imageUrl: z.string().trim().max(2000).nullable().optional(),
  kcal: macroInt,
  proteinG: macroInt,
  carbsG: macroInt,
  fatG: macroInt,
  fiberG: macroInt.nullable().optional(),
  sugarG: macroInt.nullable().optional(),
  dietType: z.enum(['veg', 'non_veg', 'egg']),
  goalTags: z.array(z.enum(['cutting', 'bulking', 'balanced'])).max(3).default([]),
  // A live menu item must carry a real price — a blank/zero price would silently
  // publish a free dish (P0-15). Members always pay ≥ 1 minor unit.
  priceMinor: z.number().int().min(1).max(100_000_000),
  currency: z.enum(['NPR', 'USD']),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const menu = await loadPartnerMenu(getDb(), guard.partnerId);
  return json({ meals: menu }, 200);
}

export async function POST(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId } = guard;

  const parsed = upsertSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const d = parsed.data;

  // A meal's currency MUST match the partner's own account currency. A mismatch
  // (e.g. a USD dish under an NPR restaurant) corrupts every downstream revenue
  // rollup, which sums minor units without re-checking currency (P0-15).
  const db = getDb();
  const [account] = await db
    .select({ currency: mealPartners.currency })
    .from(mealPartners)
    .where(eq(mealPartners.id, partnerId))
    .limit(1);
  if (!account) return json({ error: 'forbidden' }, 403);
  if (d.currency !== account.currency) {
    return json({ error: 'currency_mismatch', expected: account.currency }, 400);
  }

  const [meal] = await db
    .insert(meals)
    .values({
      partnerId,
      name: d.name,
      description: d.description,
      imageUrl: d.imageUrl ?? null,
      kcal: d.kcal,
      proteinG: d.proteinG,
      carbsG: d.carbsG,
      fatG: d.fatG,
      fiberG: d.fiberG ?? null,
      sugarG: d.sugarG ?? null,
      dietType: d.dietType,
      goalTags: d.goalTags,
      priceMinor: d.priceMinor,
      currency: d.currency,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
    })
    .returning();

  return json({ meal }, 201);
}
