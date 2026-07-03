import { planVideos } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Admin video library — single-row routes.
 *
 *  - PATCH  → edit title/description/tierRequired/position and/or flip status.
 *             The upload-confirm step sends { status: 'ready' } once the browser
 *             has finished PUTting bytes to Cloudflare. Every field is optional;
 *             an empty body is a no-op error (400). Audited.
 *  - DELETE → soft-delete (status='removed'); best-effort provider.deleteVideo()
 *             on the CF uid so the bytes are reclaimed. The row is retained for
 *             audit/history. Missing CF keys or a provider error do NOT block the
 *             soft-delete. Audited.
 *
 * Both guarded by requirePermission('content.video.publish'); super_admin passes.
 */

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    tierRequired: z.enum(['starter', 'silver', 'gold', 'elite']).optional(),
    position: z.number().int().min(0).optional(),
    status: z.enum(['processing', 'ready', 'removed']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

/** Best-effort caller IP for the audit trail (proxy header, first hop). */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip');
}

export function OPTIONS() {
  return preflight();
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'content.video.publish');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const fields = parsed.data;

  const updated = await getDb()
    .update(planVideos)
    .set(fields)
    .where(eq(planVideos.id, id))
    .returning({
      id: planVideos.id,
      title: planVideos.title,
      description: planVideos.description,
      exerciseId: planVideos.exerciseId,
      planId: planVideos.planId,
      tierRequired: planVideos.tierRequired,
      status: planVideos.status,
      position: planVideos.position,
      thumbnailUrl: planVideos.thumbnailUrl,
      durationSec: planVideos.durationSec,
      createdAt: planVideos.createdAt,
    });

  const video = updated[0];
  if (!video) return json({ error: 'not_found' }, 404);

  await logAudit(
    principal,
    'content.video.update',
    'plan_video',
    video.id,
    { fields: Object.keys(fields) },
    clientIp(req),
  );

  return json({ video }, 200);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePermission(req, 'content.video.publish');
  if (principal instanceof Response) return principal;

  const { id } = await params;
  const db = getDb();

  const updated = await db
    .update(planVideos)
    .set({ status: 'removed' })
    .where(eq(planVideos.id, id))
    .returning({
      id: planVideos.id,
      providerVideoId: planVideos.providerVideoId,
      status: planVideos.status,
    });

  const video = updated[0];
  if (!video) return json({ error: 'not_found' }, 404);

  // Reclaim the bytes on Cloudflare — best effort. A missing provider config or
  // a provider error must not fail the soft-delete the caller already committed.
  try {
    await getVideoProvider().deleteVideo(video.providerVideoId);
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) {
      // Swallow real provider errors too: the row is already 'removed'. Owner
      // can prune orphaned CF videos out-of-band if needed.
    }
  }

  await logAudit(
    principal,
    'content.video.delete',
    'plan_video',
    video.id,
    {},
    clientIp(req),
  );

  return json({ video: { id: video.id, status: video.status } }, 200);
}
