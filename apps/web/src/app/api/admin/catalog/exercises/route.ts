import { exercises, planExercises } from '@gym/db';
import { asc, count, ilike, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin catalog — exercise library (gap build P2-16, content_admin surface).
 *
 * This table is the runtime source of truth for the authenticated member
 * snapshot at GET /api/me/training-catalog. Saved edits reach members on
 * their next catalog refresh. `packages/db` also has `plan_exercises.exercise_id`
 * REFERENCES exercises(id) with NO onDelete cascade, so a DELETE on an
 * exercise still referenced by a plan is rejected by Postgres — the [id]
 * route maps that FK violation to a friendly 409 instead of a raw 500.
 *
 *  - GET  ?q=&limit= → search by name (ILIKE), alphabetical, capped at
 *    `limit` (default 50, max 200 — no cursor/offset paging yet, matching the
 *    catalog's current scale). Includes `usedByPlanCount` per row so the
 *    console can warn before a delete that will 409.
 *  - POST → create a new exercise row. `id` is optional — when omitted we
 *    slugify `name` and disambiguate on collision (content editors do not
 *    need to invent a stable free-exercise-db-style slug by hand).
 *
 * Guarded by requirePermission('catalog.manage') — content_admin preset +
 * super_admin/main_admin bypass.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'exercise';
}

const createSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    // Canonical exercise-id space is the bundled free-exercise-db slug
    // (WP-9 / contract C-G): mixed-case with underscores AND hyphens
    // (e.g. 'Barbell_Squat', '3_4_Sit-Up'). The old lowercase-hyphen-only
    // rule made it impossible to author a row matching a member-visible
    // exercise, which is exactly what plan_videos.exercise_id must FK to.
    .regex(/^[A-Za-z0-9_-]+$/, 'letters, numbers, underscores, and hyphens only')
    .optional(),
  name: z.string().trim().min(1).max(200),
  muscleGroup: z.string().trim().min(1).max(100),
  secondaryMuscles: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  equipment: z.string().trim().max(100).optional(),
  level: z.string().trim().max(50).optional(),
  category: z.string().trim().max(50).optional(),
  instructions: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  imageUrls: z.array(z.string().trim().url().max(2000)).max(10).optional(),
});

const MAX_SLUG_ATTEMPTS = 20;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { q, limit } = parsed.data;

  const db = getDb();
  const where = q ? ilike(exercises.name, `%${q.replace(/[\\%_]/g, '\\$&')}%`) : undefined;

  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      muscleGroup: exercises.muscleGroup,
      secondaryMuscles: exercises.secondaryMuscles,
      equipment: exercises.equipment,
      level: exercises.level,
      category: exercises.category,
      instructions: exercises.instructions,
      imageUrls: exercises.imageUrls,
    })
    .from(exercises)
    .where(where)
    .orderBy(asc(exercises.name))
    .limit(limit ?? DEFAULT_LIMIT);

  // Usage counts, one grouped query over just this page's ids rather than
  // N+1 per row or an unbounded table scan.
  const ids = rows.map((r) => r.id);
  const usageMap = new Map<string, number>();
  if (ids.length > 0) {
    const usageRows = await db
      .select({ exerciseId: planExercises.exerciseId, n: count() })
      .from(planExercises)
      .where(inArray(planExercises.exerciseId, ids))
      .groupBy(planExercises.exerciseId);
    for (const r of usageRows) usageMap.set(r.exerciseId, Number(r.n));
  }

  return json(
    {
      exercises: rows.map((r) => ({ ...r, usedByPlanCount: usageMap.get(r.id) ?? 0 })),
    },
    200,
  );
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { name, muscleGroup, secondaryMuscles, equipment, level, category, instructions, imageUrls } =
    parsed.data;

  const db = getDb();

  const values = {
    name,
    muscleGroup,
    secondaryMuscles: secondaryMuscles ?? [],
    equipment: equipment || null,
    level: level || null,
    category: category || null,
    instructions: instructions ?? [],
    imageUrls: imageUrls ?? [],
  };

  let created: { id: string } | undefined;

  if (parsed.data.id) {
    const inserted = await db
      .insert(exercises)
      .values({ id: parsed.data.id, ...values })
      .onConflictDoNothing({ target: exercises.id })
      .returning({ id: exercises.id });
    if (inserted.length === 0) return json({ error: 'id_taken' }, 409);
    created = inserted[0];
  } else {
    const base = slugify(name);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS && !created; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const inserted = await db
        .insert(exercises)
        .values({ id: candidate, ...values })
        .onConflictDoNothing({ target: exercises.id })
        .returning({ id: exercises.id });
      created = inserted[0];
    }
    if (!created) return json({ error: 'id_generation_failed' }, 500);
  }

  await logAudit(
    principal,
    'catalog.exercise.create',
    'exercise',
    created.id,
    { name, muscleGroup },
    clientIp(req),
  );

  return json({ id: created.id }, 201);
}
