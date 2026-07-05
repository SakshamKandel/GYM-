import { exercises, planVideos } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the video library, read model with engagement + attachment.
 *
 *  - GET → every plan_videos row (newest first) carrying title, tierRequired,
 *          status, position, thumbnailUrl, VIEWS, and the attached exercise
 *          (id + name, or null when the video is plan-level or standalone).
 *          Removed rows are included so the coach can see history; the console
 *          can filter client-side.
 *
 * Guarded by requirePermission('content.video.publish') — the SAME permission
 * that content_admin and coach hold, so a coach sees the library. ADD / RETIER
 * / REMOVE reuse the existing content routes unchanged (they're already gated
 * on content.video.publish, which coach holds):
 *   - POST   /api/admin/videos        (reserve upload + create row)
 *   - PATCH  /api/admin/videos/[id]   (title/description/tierRequired/position/status)
 *   - DELETE /api/admin/videos/[id]   (soft-delete status='removed')
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'content.video.publish');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({
      id: planVideos.id,
      title: planVideos.title,
      tierRequired: planVideos.tierRequired,
      status: planVideos.status,
      position: planVideos.position,
      thumbnailUrl: planVideos.thumbnailUrl,
      views: planVideos.views,
      exerciseId: planVideos.exerciseId,
      exerciseName: exercises.name,
      createdAt: planVideos.createdAt,
    })
    .from(planVideos)
    .leftJoin(exercises, eq(exercises.id, planVideos.exerciseId))
    .orderBy(desc(planVideos.createdAt));

  const videos = rows.map((r) => ({
    id: r.id,
    title: r.title,
    tierRequired: r.tierRequired,
    status: r.status,
    position: r.position,
    thumbnailUrl: r.thumbnailUrl,
    views: r.views,
    exercise: r.exerciseId
      ? { id: r.exerciseId, name: r.exerciseName ?? null }
      : null,
    createdAt: r.createdAt,
  }));

  return json({ videos }, 200);
}
