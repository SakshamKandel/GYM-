import { planVideos } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { logAudit } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { NotConfiguredError } from '@/lib/video';
import { verifyCloudinaryAsset } from '@/lib/video/cloudinaryProvider';

/**
 * Ready-flip requeue (v1.0.3, deferred P1 — `videos/[id]/route.ts` ready-flip
 * fix). Cloudinary's asset-existence check is read-after-write: a browser
 * upload that just finished can 404 for a few seconds before the host's index
 * catches up. The PATCH ready-flip in `videos/[id]/route.ts` still fails
 * closed on that 404 (never flips a never-uploaded video ready), but a row
 * that hits it is no longer stranded — this helper is a second, idempotent
 * chance to flip it, called from every GET that reads processing rows
 * (the admin video list route + the single-row GET) so a stuck row self-heals
 * the next time an admin console reloads the library, with no manual retry
 * action required.
 *
 * Re-verifies one 'processing' cloudinary-hosted row and flips it to 'ready'
 * if the asset now exists on the host. No-op (returns null) for anything that
 * isn't a pending cloudinary row, or whose asset still 404s.
 */
export async function reverifyProcessingVideo(row: {
  id: string;
  provider: string;
  providerVideoId: string;
  status: string;
}): Promise<'ready' | null> {
  if (row.status !== 'processing' || row.provider !== 'cloudinary') return null;

  try {
    const exists = await verifyCloudinaryAsset(row.providerVideoId);
    if (!exists) return null;
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) {
      console.error('[videos] requeue re-verify failed', err);
    }
    return null;
  }

  const db = getDb();
  const updated = await db
    .update(planVideos)
    .set({ status: 'ready' })
    .where(and(eq(planVideos.id, row.id), eq(planVideos.status, 'processing')))
    .returning({ id: planVideos.id });
  if (!updated[0]) return null;

  await logAudit(
    { id: 'system' },
    'content.video.autoready',
    'plan_video',
    row.id,
    { reason: 'requeue_reverify' },
    null,
  );
  return 'ready';
}
