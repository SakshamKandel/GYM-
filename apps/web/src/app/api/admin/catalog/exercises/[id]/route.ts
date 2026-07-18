import { exercises } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin catalog — single exercise row.
 *
 *  - PATCH  → edit any subset of fields. Empty body is a 400.
 *  - DELETE → hard delete. `plan_exercises.exercise_id` REFERENCES exercises
 *    with no cascade, so Postgres rejects deleting an exercise still used by
 *    a plan (FK violation, code 23503) — we map that to 409 `in_use` instead
 *    of a raw 500, so the console can say "remove it from every plan first".
 *
 * Guarded by requirePermission('catalog.manage').
 */

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    muscleGroup: z.string().trim().min(1).max(100).optional(),
    secondaryMuscles: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    equipment: z.string().trim().max(100).nullable().optional(),
    level: z.string().trim().max(50).nullable().optional(),
    category: z.string().trim().max(50).nullable().optional(),
    instructions: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
    imageUrls: z.array(z.string().trim().url().max(2000)).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

/** Postgres/driver error shape carrying a SQLSTATE code, when present. */
function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const fields = parsed.data;

  const db = getDb();
  const updated = await db
    .update(exercises)
    .set({
      ...fields,
      equipment: fields.equipment === undefined ? undefined : fields.equipment || null,
      level: fields.level === undefined ? undefined : fields.level || null,
      category: fields.category === undefined ? undefined : fields.category || null,
    })
    .where(eq(exercises.id, id))
    .returning({ id: exercises.id });

  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  await logAudit(
    principal,
    'catalog.exercise.update',
    'exercise',
    id,
    { fields: Object.keys(fields) },
    clientIp(req),
  );

  return json({ id }, 200);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  try {
    const deleted = await db
      .delete(exercises)
      .where(eq(exercises.id, id))
      .returning({ id: exercises.id });
    if (deleted.length === 0) return json({ error: 'not_found' }, 404);
  } catch (err) {
    if (pgErrorCode(err) === '23503') {
      return json({ error: 'in_use' }, 409);
    }
    throw err;
  }

  await logAudit(principal, 'catalog.exercise.delete', 'exercise', id, {}, clientIp(req));

  return json({ id }, 200);
}
