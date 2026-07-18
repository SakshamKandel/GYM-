import { gymPhotos } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { clientIp } from '@/lib/rateLimit';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * DELETE a single gym photo — admin-only (plan §4: "photos … admin-only
 * delete"). Scoped by BOTH gymId and photoId so a photo id from a different
 * gym can never be deleted through the wrong gym's URL.
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const { id, photoId } = await params;
  const db = getDb();

  const deleted = await db
    .delete(gymPhotos)
    .where(and(eq(gymPhotos.id, photoId), eq(gymPhotos.gymId, id)))
    .returning({ id: gymPhotos.id });

  if (deleted.length === 0) return json({ error: 'not_found' }, 404);

  await logAudit(principal, 'gym.photo.delete', 'gym', id, { photoId }, clientIp(req));

  return json({ id: photoId }, 200);
}
