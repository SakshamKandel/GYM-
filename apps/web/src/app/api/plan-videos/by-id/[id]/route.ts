import { planVideos } from '@gym/db';
import { compareTiers } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { NotConfiguredError, getVideoProvider } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Mobile-facing signed playback for a SPECIFIC library video (member read-path).
 *
 * GET /api/plan-videos/by-id/[id]
 *   Sibling of GET /api/plan-videos/[exerciseId] — that route resolves the first
 *   ready video for an exercise, which is right for the exercise-detail "coach
 *   demo" slot but wrong for the browse library, where a row is a specific video
 *   (an exercise can have several, and plan-only videos have no exerciseId at
 *   all). This route signs the exact row the member tapped.
 *
 *   - Bearer auth via userForToken (suspended accounts get null → 401).
 *   - Row must exist and be status='ready' → else 404.
 *   - Tier gate SERVER-SIDE via @gym/shared compareTiers BEFORE minting anything:
 *     user.tier rank must be >= row.tierRequired rank. Locked → 403
 *     { error:'locked', requiredTier }.
 *   - Allowed → mints a short-lived signed URL, best-effort increments the view
 *     counter, returns { url, title, description, tierRequired }.
 *   - Provider missing its keys → 503 { error:'video_not_configured' }.
 *
 * The `by-id` segment is deliberately not a valid free-exercise-db slug, so it
 * can never collide with the [exerciseId] sibling route.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);

  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { id } = await params;

  const rows = await getDb()
    .select({
      id: planVideos.id,
      providerVideoId: planVideos.providerVideoId,
      title: planVideos.title,
      description: planVideos.description,
      tierRequired: planVideos.tierRequired,
    })
    .from(planVideos)
    .where(and(eq(planVideos.id, id), eq(planVideos.status, 'ready')))
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
    // update must NEVER block or fail playback.
    try {
      await getDb()
        .update(planVideos)
        .set({ views: sql`${planVideos.views} + 1` })
        .where(eq(planVideos.id, row.id));
    } catch {
      // ignore — playback is the contract, the view counter is advisory.
    }

    return json(
      { url, title: row.title, description: row.description, tierRequired: row.tierRequired },
      200,
    );
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return json({ error: 'video_not_configured' }, 503);
    }
    throw err;
  }
}
