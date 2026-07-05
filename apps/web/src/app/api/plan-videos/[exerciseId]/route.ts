import { planVideos } from '@gym/db';
import { compareTiers } from '@gym/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { NotConfiguredError, getVideoProvider } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Mobile-facing signed playback for an exercise's form-check video.
 *
 * GET /api/plan-videos/[exerciseId]
 *   - Bearer auth via userForToken (suspended accounts get null → 401).
 *   - Finds the first ready plan_videos row for the exercise (by position).
 *   - Enforces the tier gate SERVER-SIDE using @gym/shared compareTiers BEFORE
 *     minting anything: user.tier rank must be >= row.tierRequired rank.
 *   - Locked → 403 { error:'locked', requiredTier }.
 *   - Allowed → mints a short-lived signed HLS URL and returns { url, title,
 *     tierRequired }. The provider uid and any public URL are never returned.
 *   - Provider missing its keys → NotConfiguredError → 503
 *     { error:'video_not_configured' }.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);

  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { exerciseId } = await params;

  const rows = await getDb()
    .select({
      id: planVideos.id,
      providerVideoId: planVideos.providerVideoId,
      title: planVideos.title,
      tierRequired: planVideos.tierRequired,
    })
    .from(planVideos)
    .where(and(eq(planVideos.exerciseId, exerciseId), eq(planVideos.status, 'ready')))
    .orderBy(asc(planVideos.position))
    .limit(1);

  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  // Server-side tier gate — reuse the shared ladder; never trust the client.
  if (compareTiers(user.tier, row.tierRequired) < 0) {
    return json({ error: 'locked', requiredTier: row.tierRequired }, 403);
  }

  try {
    const url = await getVideoProvider().signedPlaybackUrl(row.providerVideoId);

    // Count a view: exactly one per successful, tier-allowed 200. Atomic SQL
    // increment (no read-modify-write race). Best-effort — a failed counter
    // update must NEVER block or fail playback, so we swallow any error and
    // still return the URL.
    try {
      await getDb()
        .update(planVideos)
        .set({ views: sql`${planVideos.views} + 1` })
        .where(eq(planVideos.id, row.id));
    } catch {
      // ignore — playback is the contract, the view counter is advisory.
    }

    return json({ url, title: row.title, tierRequired: row.tierRequired }, 200);
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return json({ error: 'video_not_configured' }, 503);
    }
    throw err;
  }
}
