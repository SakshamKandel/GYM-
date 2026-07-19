import { exercises, planVideos } from '@gym/db';
import { compareTiers } from '@gym/shared';
import { asc, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Mobile-facing video LIBRARY listing (member read-path).
 *
 * GET /api/plan-videos
 *   - Bearer auth via userForToken (suspended accounts get null → 401).
 *   - Returns every `ready` plan_videos row as a browseable catalogue, ordered
 *     by (position, createdAt). No signed playback URL is minted here — that is
 *     disposable and per-play, so it stays in GET /api/plan-videos/by-id/[id];
 *     this list only carries the metadata the browse screen needs plus a
 *     server-computed `locked` flag (the member's tier rank vs the row's
 *     required tier, via @gym/shared compareTiers — never trust the client).
 *   - providerVideoId is NEVER included in the projection.
 *
 * Locked rows are intentionally returned (with locked:true) so the browse
 * screen can show an "unlock with <tier>" affordance rather than hiding paid
 * content entirely.
 */

/** Hard cap on rows returned — the catalogue is small and un-paged today. */
const MAX_ROWS = 200;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);

  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const rows = await getDb()
    .select({
      id: planVideos.id,
      exerciseId: planVideos.exerciseId,
      exerciseName: exercises.name,
      title: planVideos.title,
      description: planVideos.description,
      tierRequired: planVideos.tierRequired,
      thumbnailUrl: planVideos.thumbnailUrl,
      durationSec: planVideos.durationSec,
      views: planVideos.views,
    })
    .from(planVideos)
    .leftJoin(exercises, eq(exercises.id, planVideos.exerciseId))
    .where(eq(planVideos.status, 'ready'))
    .orderBy(asc(planVideos.position), asc(planVideos.createdAt))
    .limit(MAX_ROWS);

  const videos = rows.map((r) => ({
    id: r.id,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    title: r.title,
    description: r.description,
    tierRequired: r.tierRequired,
    thumbnailUrl: r.thumbnailUrl,
    durationSec: r.durationSec,
    views: r.views,
    // Server-side tier gate — the SAME ladder the playback route enforces, so a
    // row shown as unlocked here is guaranteed playable, and a locked row 403s.
    locked: compareTiers(user.tier, r.tierRequired) < 0,
  }));

  return json({ videos }, 200);
}
