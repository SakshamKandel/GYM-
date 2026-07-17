import { planVideos } from '@gym/db';
import { and, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, type Principal, requireAnyPermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';
import { verifyCloudinaryAsset } from '@/lib/video/cloudinaryProvider';

export const runtime = 'nodejs';

/**
 * Admin video library — single-row routes.
 *
 *  - PATCH  → edit title/description/tierRequired/position and/or flip status.
 *             The upload-confirm step sends { status: 'ready' } once the browser
 *             has finished POSTing bytes to the host; before flipping to 'ready'
 *             we verify the asset actually exists on the host (F4) so a client
 *             can't mark a never-uploaded video ready. Every field is optional;
 *             an empty body is a no-op error (400). Audited.
 *  - DELETE → soft-delete (status='removed'); best-effort provider.deleteVideo()
 *             on the host uid so the bytes are reclaimed. The row is retained for
 *             audit/history. Missing keys or a provider error do NOT block the
 *             soft-delete. Audited.
 *
 * Access (RBAC design §1.2/§4.9, defect A2): a caller needs EITHER
 * `content.manage` (org-wide — may mutate ANY row) OR `content.video.own` (a
 * coach — may mutate only rows they authored). Own-scoped callers get an extra
 * `createdBy = principal.id` predicate on every mutation WHERE, so a non-owned
 * or non-existent id both resolve to 404 — no existence oracle, no cross-coach
 * retier/delete. super_admin/main_admin bypass (content.manage). A retier to a
 * lower tier is an entitlement change and a DELETE destroys host bytes, so this
 * scoping is load-bearing, not cosmetic.
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

/**
 * Resolve the caller and the row-scope predicate for a mutation. Returns a
 * Response to early-return (401/403), or `{ principal, scope }` where `scope` is
 * the WHERE the mutation must use: `content.manage` holders get the bare id
 * match; own-scoped coaches get `id AND createdBy=principal.id`. A caller with
 * neither content permission is rejected 403 (fail closed).
 */
async function resolveScope(
  req: Request,
  id: string,
): Promise<{ principal: Principal; scope: SQL; ownScoped: boolean } | Response> {
  const access = await requireAnyPermission(req, ['content.manage', 'content.video.own']);
  if (access instanceof Response) return access;
  const { principal, permissions } = access;

  const canManage = permissions.has('content.manage');

  const scope = canManage
    ? eq(planVideos.id, id)
    : and(eq(planVideos.id, id), eq(planVideos.createdBy, principal.id))!;
  return { principal, scope, ownScoped: !canManage };
}

export function OPTIONS() {
  return preflight();
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resolved = await resolveScope(req, id);
  if (resolved instanceof Response) return resolved;
  const { principal, scope } = resolved;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const fields = parsed.data;

  const db = getDb();

  // Before flipping a row to 'ready', confirm the asset really landed on the
  // host (F4). Read the row FIRST through the same scope so an own-scoped coach
  // gets a 404 (not an oracle) on a foreign/missing id, then verify.
  if (fields.status === 'ready') {
    const rows = await db
      .select({
        provider: planVideos.provider,
        providerVideoId: planVideos.providerVideoId,
      })
      .from(planVideos)
      .where(scope)
      .limit(1);
    const row = rows[0];
    if (!row) return json({ error: 'not_found' }, 404);

    // Only cloudinary-hosted rows can be verified here; other hosts confirm via
    // their own flow. Fail OPEN on ambiguous/transient errors (log + proceed)
    // so a rate-limited admin API can't wedge legitimate uploads; fail CLOSED
    // only on a definitive "asset does not exist".
    if (row.provider === 'cloudinary') {
      try {
        const exists = await verifyCloudinaryAsset(row.providerVideoId);
        if (!exists) return json({ error: 'asset_not_found' }, 409);
      } catch (err) {
        if (!(err instanceof NotConfiguredError)) {
          console.error('[videos] ready-flip asset verify failed', err);
        }
        // NotConfiguredError (no keys) or transient error → skip verification.
      }
    }
  }

  const updated = await db
    .update(planVideos)
    .set(fields)
    .where(scope)
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
  const { id } = await params;

  const resolved = await resolveScope(req, id);
  if (resolved instanceof Response) return resolved;
  const { principal, scope } = resolved;

  const db = getDb();

  const updated = await db
    .update(planVideos)
    .set({ status: 'removed' })
    .where(scope)
    .returning({
      id: planVideos.id,
      providerVideoId: planVideos.providerVideoId,
      status: planVideos.status,
    });

  const video = updated[0];
  if (!video) return json({ error: 'not_found' }, 404);

  // Reclaim the bytes on the host — best effort. A missing provider config or
  // a provider error must not fail the soft-delete the caller already committed.
  try {
    await getVideoProvider().deleteVideo(video.providerVideoId);
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) {
      // Swallow real provider errors too: the row is already 'removed'. Owner
      // can prune orphaned host videos out-of-band if needed.
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
