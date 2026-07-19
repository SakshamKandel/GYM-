import { planVideos } from '@gym/db';
import { desc, ne } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { isVideoConfigured } from '@/lib/video';
import { reverifyProcessingVideo } from '@/lib/video/requeue';
import { ContentTabs } from './_components/ContentTabs';
import type { Tier, VideoListItem, VideoStatus } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin content section — the plan-video library. The admin layout already gates
 * this route (only super_admin + content_admin see the nav link and pass the
 * subtree guard), but we re-resolve the principal here to fail safe if reached
 * directly, matching the other admin pages.
 *
 * This page does the initial library READ server-side via getDb (mirroring the
 * projection GET /api/admin/videos returns, incl. the ready-flip requeue
 * self-heal — see loadVideos() below), computes the summary tiles, and
 * hands the rows to the client <VideoLibrary>. All mutations — uploading,
 * changing a tier, removing — go through the guarded /api/admin/videos routes
 * (the httpOnly gt_staff cookie rides along) and patch the local list, so the
 * table stays live without a full server refetch. `videoConfigured` seeds the
 * "hosting not configured" state so the banner shows even before the first
 * upload attempt.
 */

/**
 * Reads the full library (minus soft-removed rows), newest first.
 *
 * Ready-flip requeue (v1.0.3 fix): this server-rendered read is a distinct
 * query path from GET /api/admin/videos, so it must re-run the same
 * self-heal — otherwise a row stranded in 'processing' by the Cloudinary
 * read-after-write 404 window (see lib/video/requeue.ts) never recovers via
 * a page reload, only via a direct call to the API route (mobile only).
 */
async function loadVideos(): Promise<VideoListItem[]> {
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
      durationSec: planVideos.durationSec,
      createdAt: planVideos.createdAt,
    })
    .from(planVideos)
    .where(ne(planVideos.status, 'removed'))
    .orderBy(desc(planVideos.createdAt));

  return Promise.all(
    rows.map(async (r) => {
      const healed = await reverifyProcessingVideo(r);
      return {
        id: r.id,
        title: r.title,
        tierRequired: r.tierRequired as Tier,
        status: (healed === 'ready' ? 'ready' : r.status) as VideoStatus,
        position: r.position,
        thumbnailUrl: r.thumbnailUrl,
        durationSec: r.durationSec,
        createdAt:
          r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      };
    }),
  );
}

export default async function AdminContentPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  const canManageContent = permissions.has('content.manage');
  const canModerate = permissions.has('moderation.manage');
  // Either capability grants access to this route now — content.manage sees
  // the video library, moderation.manage sees the moderation tabs. Someone
  // with neither has nothing to do here.
  if (!canManageContent && !canModerate) redirect('/admin');

  // Only read the video library when it will actually render — a
  // moderation-only caller (e.g. a future content_admin split) shouldn't pay
  // for a query it can't see.
  const videos = canManageContent ? await loadVideos() : [];
  const configured = isVideoConfigured();

  const total = videos.length;
  const ready = videos.filter((v) => v.status === 'ready').length;
  const processing = videos.filter((v) => v.status === 'processing').length;

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Content"
        subtitle="Form-check videos shown inside the training plans, plus moderation for member-visible coach content."
      />

      {canManageContent ? (
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
      ) : null}

      <ContentTabs
        videos={videos}
        videoConfigured={configured}
        canManageContent={canManageContent}
        canModerate={canModerate}
      />
    </div>
  );
}
