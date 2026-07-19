import { gymReviews } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Hide/show one gym review (Pack C moderation lever). Hiding removes it from
 * the public GET /api/gyms/[slug]/reviews list AND the rating aggregate
 * immediately (both are computed live from `status='visible'` rows — no
 * cache to invalidate). Audited either direction.
 */

const patchSchema = z.object({ status: z.enum(['visible', 'hidden']) });

export function OPTIONS() {
  return preflight();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const [existing] = await db.select({ id: gymReviews.id }).from(gymReviews).where(eq(gymReviews.id, id)).limit(1);
  if (!existing) return json({ error: 'not_found' }, 404);

  await db.update(gymReviews).set({ status: parsed.data.status }).where(eq(gymReviews.id, id));
  await logAudit(principal, 'gym_review.moderate', 'gym_review', id, { status: parsed.data.status });

  return json({ ok: true }, 200);
}
