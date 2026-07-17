import { planVideos } from '@gym/db';
import { desc, ne } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { isVideoConfigured } from '@/lib/video';
import type { Tier, VideoListItem, VideoStatus } from './_components/types';
import { VideoLibrary } from './_components/VideoLibrary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin content section — the plan-video library. The admin layout already gates
 * this route (only super_admin + content_admin see the nav link and pass the
 * subtree guard), but we re-resolve the principal here to fail safe if reached
 * directly, matching the other admin pages.
 *
 * This page does the initial library READ server-side via getDb (mirroring the
 * projection GET /api/admin/videos returns), computes the summary tiles, and
 * hands the rows to the client <VideoLibrary>. All mutations — uploading,
 * changing a tier, removing — go through the guarded /api/admin/videos routes
 * (the httpOnly gt_staff cookie rides along) and patch the local list, so the
 * table stays live without a full server refetch. `videoConfigured` seeds the
 * "hosting not configured" state so the banner shows even before the first
 * upload attempt.
 */

/** Reads the full library (minus soft-removed rows), newest first. */
async function loadVideos(): Promise<VideoListItem[]> {
  const rows = await getDb()
    .select({
      id: planVideos.id,
      title: planVideos.title,
      tierRequired: planVideos.tierRequired,
      status: planVideos.status,
      position: planVideos.position,
      thumbnailUrl: planVideos.thumbnailUrl,
      durationSec: planVideos.durationSec,
      createdAt: planVideos.createdAt,
    })
    .from(planVideos)
    .where(ne(planVideos.status, 'removed'))
    .orderBy(desc(planVideos.createdAt));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    tierRequired: r.tierRequired as Tier,
    status: r.status as VideoStatus,
    position: r.position,
    thumbnailUrl: r.thumbnailUrl,
    durationSec: r.durationSec,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

export default async function AdminContentPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('content.manage')) redirect('/admin');

  const videos = await loadVideos();
  const configured = isVideoConfigured();

  const total = videos.length;
  const ready = videos.filter((v) => v.status === 'ready').length;
  const processing = videos.filter((v) => v.status === 'processing').length;

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Content"
        subtitle="Form-check videos shown inside the training plans. Each video is gated to a membership tier — members below it don't see it."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Videos" value={total} />
        <StatTile label="Ready" value={ready} hint={total > 0 ? `of ${total}` : undefined} />
        <StatTile
          label="Processing"
          value={processing}
          hint={processing > 0 ? 'awaiting host' : undefined}
        />
      </div>

      <VideoLibrary initialVideos={videos} videoConfigured={configured} />
    </div>
  );
}
