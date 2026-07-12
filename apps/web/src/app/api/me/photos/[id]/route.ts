import { progressPhotos } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * DELETE own progress photo row. No entitlement gate — a member who has since
 * dropped below silver should still be able to clean up their own history.
 * Scoped to accountId so one member can never delete another's row (404, not
 * 403, to avoid confirming the id exists for someone else's photo).
 *
 * NOTE: this removes the DB row only; the underlying Cloudinary asset is left
 * in place (out of scope for §4.5 — no deleteImage on the provider yet).
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'me/photos/delete',
    limit: 30,
    windowMs: 60 * 60 * 1000,
    accountId: user.id,
  });
  if (limited) return limited;

  const { id } = await params;

  const deleted = await getDb()
    .delete(progressPhotos)
    .where(and(eq(progressPhotos.id, id), eq(progressPhotos.accountId, user.id)))
    .returning({ id: progressPhotos.id });

  if (deleted.length === 0) return json({ error: 'not_found' }, 404);
  return json({ ok: true }, 200);
}
