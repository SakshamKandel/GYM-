import { gymReports } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Resolve or dismiss one gym-report row (plan §5 WP-11). `resolved` = the
 * listing was fixed; `dismissed` = the report was invalid/duplicate. Both are
 * terminal from the admin's point of view — there is no "reopen" because a
 * member can always file a fresh report if the issue recurs. Audited.
 */

const patchSchema = z.object({ status: z.enum(['resolved', 'dismissed']) });

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
  const [existing] = await db.select({ id: gymReports.id }).from(gymReports).where(eq(gymReports.id, id)).limit(1);
  if (!existing) return json({ error: 'not_found' }, 404);

  await db.update(gymReports).set({ status: parsed.data.status }).where(eq(gymReports.id, id));
  await logAudit(principal, 'gym_report.decide', 'gym_report', id, { status: parsed.data.status });

  return json({ ok: true }, 200);
}
