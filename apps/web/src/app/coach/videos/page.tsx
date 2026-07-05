import { exercises, planVideos } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { isVideoConfigured } from '@/lib/video';
import type { CoachVideoRow, Tier, VideoStatus } from './_components/types';
import { CoachVideoLibrary } from './_components/CoachVideoLibrary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach content — the form-check video library. The coach layout already gates
 * this route (only coach / super_admin / main_admin reach it), but we
 * re-resolve the principal here to fail safe if the URL is hit directly,
 * matching the other coach pages.
 *
 * A coach holds `content.video.publish` — the SAME permission the content admin
 * uses — so the coach manages the one shared library. This page does the
 * initial READ server-side (mirroring GET /api/coach/videos: every row incl.
 * removed, newest first, with views + the attached exercise), then hands the
 * rows to the client <CoachVideoLibrary>. Every mutation — uploading, changing
 * a tier, removing — goes through the guarded /api/admin/videos routes (the
 * httpOnly gt_staff cookie rides along; coach holds the permission) and patches
 * the local list, so the table stays live without a full refetch.
 */

/** Reads the full library (incl. removed rows), newest first, with exercise + views. */
async function loadVideos(): Promise<CoachVideoRow[]> {
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
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

export default async function CoachVideosPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/coach/login');

  const videos = await loadVideos();
  const configured = isVideoConfigured();

  const live = videos.filter((v) => v.status !== 'removed');
  const ready = live.filter((v) => v.status === 'ready').length;
  const totalViews = live.reduce((sum, v) => sum + v.views, 0);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Videos"
        subtitle="Form-check videos shown inside the training plans. Each video is gated to a membership tier — members below it don't see it. Add, re-tier, or remove any video here."
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

      <CoachVideoLibrary initialVideos={videos} videoConfigured={configured} />
    </div>
  );
}
