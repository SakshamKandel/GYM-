import { gymEnquiries } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Move one gym enquiry along its follow-up lifecycle. `contacted` = someone
 * has reached out to the member; `closed` = the lead is done (joined, went
 * cold, duplicate). `open` is allowed back in on purpose — unlike a report
 * decision, a lead genuinely does get reopened when a member replies later,
 * and the member has no way to re-file (the enquire route is rate-limited to
 * 5 per day across all gyms). Audited in every direction, and `handledBy`
 * records who last touched it.
 */

const patchSchema = z.object({ status: z.enum(['open', 'contacted', 'closed']) });

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
  const [existing] = await db
    .select({ id: gymEnquiries.id })
    .from(gymEnquiries)
    .where(eq(gymEnquiries.id, id))
    .limit(1);
  if (!existing) return json({ error: 'not_found' }, 404);

  await db
    .update(gymEnquiries)
    .set({ status: parsed.data.status, handledBy: principal.id, updatedAt: new Date() })
    .where(eq(gymEnquiries.id, id));
  await logAudit(principal, 'gym_enquiry.update', 'gym_enquiry', id, { status: parsed.data.status });

  return json({ ok: true }, 200);
}
