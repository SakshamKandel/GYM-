import { progressPhotos } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { getImageProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Admin console — moderator removal of a progress_photos row
 * (ADMIN-MASTER-PLAN §3 P1-9). Mirrors DELETE /api/me/photos/[id] (the
 * member's own-row delete) but without the accountId===caller scoping, and
 * always audited. The provider asset is now destroyed before the DB row. The
 * same lifecycle is used by member self-deletion and full account erasure.
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
  const [row] = await db
    .select({
      id: progressPhotos.id,
      accountId: progressPhotos.accountId,
      takenOn: progressPhotos.takenOn,
      uid: progressPhotos.imageUrl,
    })
    .from(progressPhotos)
    .where(eq(progressPhotos.id, id))
    .limit(1);
  if (!row) return json({ error: 'not_found' }, 404);

  try {
    await getImageProvider().deleteImage(row.uid, 'authenticated');
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      return json({ error: 'image_not_configured' }, 503);
    }
    console.error('Moderated progress photo provider deletion failed', {
      photoId: row.id,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
    return json({ error: 'image_delete_failed' }, 502);
  }

  await db.delete(progressPhotos).where(eq(progressPhotos.id, row.id));

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'moderation.progress_photo.remove',
    'account',
    row.accountId,
    { photoId: row.id, takenOn: row.takenOn },
    ip,
  );

  return json({ ok: true }, 200);
}
