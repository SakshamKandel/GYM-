import { exercises, planVideos } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { PageHeader, StatTile } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { getDb } from '@/lib/db';
import { isVideoConfigured } from '@/lib/video';
import type { CoachVideoRow, Tier, VideoStatus } from './_components/types';
import { CoachVideoLibrary } from './_components/CoachVideoLibrary';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Videos' };
export const dynamic = 'force-dynamic';

/**
 * Coach content — the form-check video library. The coach layout already gates
 * this route (only coach / super_admin / main_admin reach it), but we
 * re-resolve the principal here to fail safe if the URL is hit directly,
 * matching the other coach pages.
 *
 * The LIST is org-wide on purpose (GET /api/coach/videos says so): a coach can
 * see what the whole team has published. The WRITES are not — /api/admin/videos
 * scopes a `content.video.own` holder to rows they authored and 404s the rest.
 * So each row is marked `mine` and the table only offers re-tier / Remove where
 * the server will actually accept them; a `content.manage` holder manages
 * everything and gets `canManageAll`. Before this, every row offered both and
 * another coach's row failed with a permission error after the click.
 *
 * This page does the initial READ server-side (mirroring GET /api/coach/videos:
 * every row incl. removed, newest first, with views + the attached exercise),
 * then hands the rows to the client <CoachVideoLibrary>. Every mutation —
 * uploading, changing a tier, removing — goes through the guarded
 * /api/admin/videos routes (the httpOnly gt_staff cookie rides along) and
 * patches the local list, so the table stays live without a full refetch.
 */

/** Reads the full library (incl. removed rows), newest first, with exercise + views. */
async function loadVideos(viewerId: string): Promise<CoachVideoRow[]> {
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
      createdBy: planVideos.createdBy,
      createdAt: planVideos.createdAt,
    })
    .from(planVideos)
    .leftJoin(exercises, eq(exercises.id, planVideos.exerciseId))
    .orderBy(desc(planVideos.createdAt));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    tierRequired: r.tierRequired as Tier,
    status: r.status as VideoStatus,
    position: r.position,
    thumbnailUrl: r.thumbnailUrl,
    views: r.views,
    exercise: r.exerciseId
      ? { id: r.exerciseId, name: r.exerciseName ?? null }
      : null,
    mine: r.createdBy === viewerId,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

export default async function CoachVideosPage() {
  const { principal, permissions } = await requireCoachPage([
    'content.manage',
    'content.video.own',
  ]);

  const videos = await loadVideos(principal.id);
  const configured = isVideoConfigured();
  // Same rule /api/admin/videos applies: org-wide content managers (and the two
  // top-admin roles, which hold every key) may edit any row.
  const canManageAll = permissions.has('content.manage');

  const live = videos.filter((v) => v.status !== 'removed');
  const ready = live.filter((v) => v.status === 'ready').length;
  const totalViews = live.reduce((sum, v) => sum + v.views, 0);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Videos"
        subtitle="Form-check videos shown inside the training plans. Each video is gated to a membership tier, so members below it don't see it. Add, re-tier, or remove any video here."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Videos" value={live.length} />
        <StatTile
          label="Ready"
          value={ready}
          hint={live.length > 0 ? `of ${live.length}` : undefined}
        />
        <StatTile label="Total views" value={totalViews} />
      </div>

      <CoachVideoLibrary
        initialVideos={videos}
        videoConfigured={configured}
        canManageAll={canManageAll}
      />
    </div>
  );
}
