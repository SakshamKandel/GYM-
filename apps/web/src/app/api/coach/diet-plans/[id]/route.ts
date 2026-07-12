import { type CoachDietPlanItem, type CoachDietPlanMeal, coachDietPlans } from '@gym/db';
import { maskPii } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — edit or remove one assigned diet plan row (SCALE-UP-PLAN
 * §4.3). The owning client comes from the ROW (not the request), so a coach
 * can only ever touch rows belonging to a currently-assigned client — mirrors
 * coach/flags/[workoutId] and coach/suggestions/[id]'s "look up the row, then
 * requireCoachOwnsUser on its owner" shape.
 *
 *  - PATCH {title?, notes?, status?, meals?} → partial update; any field the
 *          caller sends is masked/validated the same way POST does.
 *  - DELETE → hard-removes the row (use PATCH {status:'archived'} to hide it
 *          from the client instead while keeping history).
 *
 * Guards (both verbs, fail closed): requirePermission('coach.message.user')
 * + requireCoachOwnsUser(principal, row.clientId) → 403 when not owned;
 * missing row → 404 (checked first, so a stale/foreign id never leaks a 403
 * vs 404 oracle).
 */

const dietItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.string().trim().min(1).max(40),
  kcal: z.number().int().min(0).max(5000).optional(),
  protein: z.number().min(0).max(500).optional(),
  carbs: z.number().min(0).max(500).optional(),
  fat: z.number().min(0).max(500).optional(),
  note: z.string().trim().max(200).optional(),
});

const dietMealSchema = z.object({
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snacks']),
  items: z.array(dietItemSchema).max(12),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  meals: z.array(dietMealSchema).max(6).optional(),
});

const dietColumns = {
  id: coachDietPlans.id,
  title: coachDietPlans.title,
  notes: coachDietPlans.notes,
  status: coachDietPlans.status,
  meals: coachDietPlans.meals,
  createdAt: coachDietPlans.createdAt,
  updatedAt: coachDietPlans.updatedAt,
};

/** Masks every client-visible free-text field of one food item. */
function maskItem(item: CoachDietPlanItem): CoachDietPlanItem {
  return {
    ...item,
    name: maskPii(item.name),
    qty: maskPii(item.qty),
    note: item.note !== undefined ? maskPii(item.note) : undefined,
  };
}

function maskMeal(meal: CoachDietPlanMeal): CoachDietPlanMeal {
  return { ...meal, items: meal.items.map(maskItem) };
}

export function OPTIONS() {
  return preflight();
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({ id: coachDietPlans.id, clientId: coachDietPlans.clientId })
    .from(coachDietPlans)
    .where(eq(coachDietPlans.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  if (!(await requireCoachOwnsUser(principal, row.clientId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, notes, status, meals } = parsed.data;

  const updated = await db
    .update(coachDietPlans)
    .set({
      ...(title !== undefined ? { title: maskPii(title) } : {}),
      ...(notes !== undefined ? { notes: maskPii(notes) } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(meals !== undefined ? { meals: meals.map(maskMeal) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(coachDietPlans.id, id))
    .returning(dietColumns);

  const plan = updated[0];
  if (!plan) return json({ error: 'not_found' }, 404);

  await logAudit(principal, 'coach.diet.update', 'account', row.clientId, { planId: id });

  after(() =>
    sendPushToAccount(row.clientId, {
      title: 'Diet plan updated',
      body: 'Your coach updated one of your diet plans.',
      data: { type: 'coach_plan' },
    }),
  );

  return json({ plan }, 200);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({ id: coachDietPlans.id, clientId: coachDietPlans.clientId })
    .from(coachDietPlans)
    .where(eq(coachDietPlans.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  if (!(await requireCoachOwnsUser(principal, row.clientId))) {
    return json({ error: 'forbidden' }, 403);
  }

  await db.delete(coachDietPlans).where(eq(coachDietPlans.id, id));

  await logAudit(principal, 'coach.diet.update', 'account', row.clientId, {
    planId: id,
    deleted: true,
  });

  return json({ ok: true }, 200);
}
