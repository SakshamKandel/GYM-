import { exercises } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The parts of ONE exercise that the console's table never shows and its edit
 * form always needs: secondary muscles, instruction steps and image urls.
 *
 * Why this exists: the catalog page used to server-render those three arrays
 * for every exercise in the library, so a screen that lists names carried the
 * whole instruction text of every exercise. The page now renders the columns it
 * displays, and the edit form asks here for the row being opened.
 *
 * Read-only, so there is no audit entry (logAudit covers mutations). Guarded by
 * the same permission as the page and as the write routes it feeds
 * (PATCH /api/admin/catalog/exercises/[id]): 'catalog.manage', fail closed.
 */

const querySchema = z.object({ id: z.string().trim().min(1).max(200) });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'catalog.manage');
  if (principal instanceof Response) return principal;

  const parsed = querySchema.safeParse({
    id: new URL(req.url).searchParams.get('id') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const rows = await db
    .select({
      secondaryMuscles: exercises.secondaryMuscles,
      instructions: exercises.instructions,
      imageUrls: exercises.imageUrls,
    })
    .from(exercises)
    .where(eq(exercises.id, parsed.data.id))
    .limit(1);

  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  return json(
    {
      exercise: {
        secondaryMuscles: row.secondaryMuscles,
        instructions: row.instructions,
        imageUrls: row.imageUrls,
      },
    },
    200,
  );
}
