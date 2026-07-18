import { progressPhotos } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — moderator removal of a progress_photos row
 * (ADMIN-MASTER-PLAN §3 P1-9). Mirrors DELETE /api/me/photos/[id] (the
 * member's own-row delete) but without the accountId===caller scoping, and
 * always audited. Same NOTE as that route: this removes the DB row only, the
 * underlying Cloudinary asset is left in place (no deleteImage on the provider
 * yet — out of scope here too).
 *
 * Guarded by requirePermission('moderation.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const db = getDb();
  const deleted = await db
    .delete(progressPhotos)
    .where(eq(progressPhotos.id, id))
    .returning({ id: progressPhotos.id, accountId: progressPhotos.accountId, takenOn: progressPhotos.takenOn });

  const row = deleted[0];
  if (!row) return json({ error: 'not_found' }, 404);

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'moderation.progress_photo.remove',
    'account',
    row.accountId,
    { photoId: id, takenOn: row.takenOn },
    ip,
  );

  return json({ ok: true }, 200);
}
