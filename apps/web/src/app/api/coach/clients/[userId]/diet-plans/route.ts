import { type CoachDietPlanItem, type CoachDietPlanMeal, coachDietPlans } from '@gym/db';
import { maskPii } from '@gym/shared';
import { asc, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — a client's coach-assigned diet plans (SCALE-UP-PLAN §4.3).
 *
 *  - GET  → all of the client's rows (any status), newest first.
 *  - POST {title, notes?, status?, meals} → creates one row. Free text the
 *          client will read (title, notes, and each food item's name/qty/
 *          note) is PII-masked BEFORE storage — mirrors
 *          coach/threads/[userId]/reply's `maskPii(body)` on coach-authored
 *          text.
 *
 * Guards (both verbs, fail closed): requirePermission('coach.user.read' for
 * GET, 'coach.message.user' for POST — same permission the milestones/
 * suggestions/flags coach-write routes use) + requireCoachOwnsUser(principal,
 * userId) → 403 { error:'forbidden' } when the caller has no ACTIVE
 * assignment over this client (super_admin/main_admin pass without one).
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

const postSchema = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  meals: z.array(dietMealSchema).max(6),
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const plans = await getDb()
    .select(dietColumns)
    .from(coachDietPlans)
    .where(eq(coachDietPlans.clientId, userId))
    .orderBy(asc(coachDietPlans.createdAt));

  return json({ plans }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, notes, status, meals } = parsed.data;

  const inserted = await getDb()
    .insert(coachDietPlans)
    .values({
      coachId: principal.id,
      clientId: userId,
      title: maskPii(title),
      notes: maskPii(notes ?? ''),
      status: status ?? 'active',
      meals: meals.map(maskMeal),
    })
    .returning(dietColumns);

  const plan = inserted[0];
  if (!plan) return json({ error: 'invalid' }, 400);

  await logAudit(principal, 'coach.diet.assign', 'account', userId, { planId: plan.id });

  // Generic copy on purpose — the lock screen must never leak plan details.
  after(() =>
    sendPushToAccount(userId, {
      title: 'New diet plan from your coach',
      body: 'Your coach assigned you a new diet plan.',
      data: { type: 'coach_plan' },
    }),
  );

  return json({ plan }, 201);
}
