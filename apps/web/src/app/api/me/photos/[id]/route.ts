import { progressPhotos } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { getImageProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * DELETE own progress photo row. No entitlement gate — a member who has since
 * dropped below silver should still be able to clean up their own history.
 * Scoped to accountId so one member can never delete another's row (404, not
 * 403, to avoid confirming the id exists for someone else's photo).
 *
 * The private provider asset is destroyed before its DB reference is removed,
 * so member deletion does not leave inaccessible body imagery in storage.
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

  const db = getDb();
  const [photo] = await db
    .select({ id: progressPhotos.id, uid: progressPhotos.imageUrl })
    .from(progressPhotos)
    .where(and(eq(progressPhotos.id, id), eq(progressPhotos.accountId, user.id)))
    .limit(1);

  if (!photo) return json({ error: 'not_found' }, 404);

  try {
    await getImageProvider().deleteImage(photo.uid, 'authenticated');
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      return json({ error: 'image_not_configured' }, 503);
    }
    console.error('Progress photo provider deletion failed', {
      photoId: photo.id,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
    return json({ error: 'image_delete_failed' }, 502);
  }

  await db
    .delete(progressPhotos)
    .where(and(eq(progressPhotos.id, photo.id), eq(progressPhotos.accountId, user.id)));
  return json({ ok: true }, 200);
}
