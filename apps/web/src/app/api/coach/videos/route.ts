import { exercises, planVideos } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requireAnyPermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { reverifyProcessingVideo } from '@/lib/video/requeue';

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
 * Read-only library. Per RBAC §4.9 the GET list stays org-wide readable for
 * BOTH content keys: `content.manage` (content_admin / top admins) and
 * `content.video.own` (coach). Mutations live on the /api/admin/videos routes,
 * which scope coach writes to their own rows (createdBy) and 404 on non-owned
 * ids — no existence oracle. The retired `content.video.publish` key is gone.
 *
 * Because the list is wider than the write scope, every row carries `mine` and
 * the response carries `canManageAll`, so a console can offer Remove / re-tier
 * on exactly the rows those routes will accept rather than on rows they will
 * 404. `mine` is a BOOLEAN deliberately: which coach authored someone else's
 * row is nobody's business on this screen.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const access = await requireAnyPermission(req, ['content.manage', 'content.video.own']);
  if (access instanceof Response) return access;
  const { principal, permissions } = access;
  // Same rule the mutation routes apply: content.manage may touch any row,
  // everyone else only the rows they authored.
  const canManageAll = permissions.has('content.manage');

  const rows = await getDb()
    .select({
      id: planVideos.id,
      title: planVideos.title,
      tierRequired: planVideos.tierRequired,
      provider: planVideos.provider,
      providerVideoId: planVideos.providerVideoId,
      status: planVideos.status,
      position: planVideos.position,
      thumbnailUrl: planVideos.thumbnailUrl,
      views: planVideos.views,
      exerciseId: planVideos.exerciseId,
      exerciseName: exercises.name,
      createdBy: planVideos.createdBy,
      createdAt: planVideos.createdAt,
    })
    .from(planVideos)
    .leftJoin(exercises, eq(exercises.id, planVideos.exerciseId))
    .orderBy(desc(planVideos.createdAt));

  // Ready-flip requeue (v1.0.3 fix): this is a third, independent query over
  // plan_videos (alongside GET /api/admin/videos and /[id]) and needs the same
  // self-heal, or a row stranded in 'processing' by the Cloudinary
  // read-after-write 404 window never recovers for a coach viewing this list.
  const videos = await Promise.all(
    rows.map(async (r) => {
      const healed = await reverifyProcessingVideo(r);
      return {
        id: r.id,
        title: r.title,
        tierRequired: r.tierRequired,
        status: healed === 'ready' ? 'ready' : r.status,
        position: r.position,
        thumbnailUrl: r.thumbnailUrl,
        views: r.views,
        exercise: r.exerciseId
          ? { id: r.exerciseId, name: r.exerciseName ?? null }
          : null,
        mine: r.createdBy === principal.id,
        createdAt: r.createdAt,
      };
    }),
  );

  return json({ videos, canManageAll }, 200);
}
