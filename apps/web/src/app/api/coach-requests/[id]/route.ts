import { coachRequests } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Member cancels their own PENDING coach request. Ownership + pending state
 * live in the WHERE clause, so anything else (someone else's row, already
 * decided, unknown id) uniformly 404s — no state oracle for other members.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;

  const updated = await getDb()
    .update(coachRequests)
    .set({ status: 'canceled', decidedAt: new Date() })
    .where(
      and(
        eq(coachRequests.id, id),
        eq(coachRequests.userId, user.id),
        eq(coachRequests.status, 'pending'),
      ),
    )
    .returning({ id: coachRequests.id });

  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  return json({ ok: true }, 200);
}
