import { planVideos } from '@gym/db';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requireAnyPermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';
import { reverifyProcessingVideo } from '@/lib/video/requeue';

export const runtime = 'nodejs';

/**
 * Admin video library — collection routes.
 *
 *  - POST → reserve a direct-creator-upload slot on the configured video host,
 *           insert a plan_videos row in status='processing' (providerVideoId =
 *           the provider's asset uid, createdBy = caller), audit it, and hand the
 *           browser back the new row plus an `upload` descriptor. The browser
 *           POSTs the file straight to the host (never through Vercel), then
 *           confirms via PATCH [id] to flip status='ready'.
 *
 *           The `upload` descriptor carries the endpoint and — for hosts that use
 *           signed browser uploads (Cloudinary) — the signed form fields the
 *           browser must attach alongside the file. For self-contained one-time
 *           URLs (Cloudflare Stream) it carries just the endpoint and the browser
 *           POSTs the raw file to it. No api_secret is ever returned.
 *  - GET  → the full library for the console list (title/tier/status/position
 *           /thumbnail), newest first. Org-wide readable by BOTH content keys.
 *
 * Access (RBAC design §1.2/§4.9): a caller needs EITHER `content.manage`
 * (org-wide content admin — create/retier/remove any row) OR `content.video.own`
 * (a coach — CRUD scoped to rows they authored). Create stamps createdBy =
 * caller so the own-scope enforcement in [id] has an author to match. The GET
 * list stays org-wide for both keys (the library is a shared catalog); per-row
 * MUTATION scoping lives in the [id] route. super_admin/main_admin bypass.
 *
 * When the host keys are absent the provider throws NotConfiguredError and POST
 * returns 503 { error: 'video_not_configured' } — no row is created.
 */

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  exerciseId: z.string().trim().min(1).optional(),
  planId: z.string().trim().min(1).optional(),
  tierRequired: z.enum(['starter', 'silver', 'gold', 'elite']),
});

/** Postgres error code off a thrown driver error, if present (e.g. '23503'). */
function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Best-effort caller IP for the audit trail (proxy header, first hop). */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip');
}

/**
 * Which host string to stamp on the plan_videos.provider column. Mirrors the
 * selection logic in @/lib/video's getVideoProvider(): explicit VIDEO_PROVIDER
 * wins, else default to 'cloudinary' when its keys are present, else 'cf_stream'.
 * Kept as a plain label so the row records the true host of each asset even if
 * the env is later switched. Never changes the provider selection itself.
 */
function selectedProviderLabel(): string {
  const explicit = process.env.VIDEO_PROVIDER?.trim().toLowerCase();
  if (explicit === 'cloudinary') return 'cloudinary';
  if (explicit === 'cf_stream') return 'cf_stream';
  const hasCloudinary = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
  return hasCloudinary ? 'cloudinary' : 'cf_stream';
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const access = await requireAnyPermission(req, ['content.manage', 'content.video.own']);
  if (access instanceof Response) return access;
  const { principal } = access;

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { title, description, exerciseId, planId, tierRequired } = parsed.data;

  let reservation;
  try {
    reservation = await getVideoProvider().createDirectUpload({ name: title });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return json({ error: 'video_not_configured' }, 503);
    }
    throw err;
  }

  const db = getDb();
  // The host upload slot is already reserved above. If the DB insert fails —
  // most commonly a foreign-key violation (23503) when exerciseId/planId does
  // not resolve to a real row — the reservation would be orphaned on the host
  // and the operator would see a bare "Could not start the upload" 500. Wrap
  // the insert so we roll the reservation back and return a precise 400 the UI
  // can act on. deleteVideo is idempotent (WP-9).
  let inserted;
  try {
    inserted = await db
      .insert(planVideos)
      .values({
        title,
        description: description ?? '',
        exerciseId: exerciseId ?? null,
        planId: planId ?? null,
        tierRequired,
        provider: selectedProviderLabel(),
        providerVideoId: reservation.uid,
        status: 'processing',
        createdBy: principal.id,
      })
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
  } catch (err) {
    // Release the reserved host upload so it doesn't leak (best-effort).
    try {
      await getVideoProvider().deleteVideo(reservation.uid);
    } catch {
      /* cleanup is best-effort — never mask the original failure */
    }
    // FK violation → the attached exercise/plan doesn't exist. Actionable 400.
    if (pgErrorCode(err) === '23503') {
      return json({ error: 'invalid_exercise' }, 400);
    }
    throw err;
  }

  const video = inserted[0];
  if (!video) return json({ error: 'invalid' }, 400);

  await logAudit(
    principal,
    'content.video.create',
    'plan_video',
    video.id,
    { title, tierRequired },
    clientIp(req),
  );

  // Hand the browser a provider-neutral upload descriptor:
  //   - url    → the endpoint the browser POSTs the file to.
  //   - fields → signed form fields to attach as multipart/form-data alongside
  //              the `file` blob (Cloudinary). Omitted for hosts whose url is a
  //              self-contained one-time link (Cloudflare Stream) — in that case
  //              the browser POSTs the raw file with no extra fields.
  // The api_secret is never part of `fields`; only the derived signature is.
  const upload: { url: string; fields?: Record<string, string> } = {
    url: reservation.uploadUrl,
    ...(reservation.upload ? { fields: reservation.upload } : {}),
  };

  return json({ video, upload }, 201);
}

export async function GET(req: Request) {
  const access = await requireAnyPermission(req, ['content.manage', 'content.video.own']);
  if (access instanceof Response) return access;

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
      createdAt: planVideos.createdAt,
    })
    .from(planVideos)
    .orderBy(desc(planVideos.createdAt));

  // Ready-flip requeue (v1.0.3): a row can be stuck in 'processing' because a
  // prior PATCH confirm hit Cloudinary's read-after-write 404 window. Rather
  // than strand it forever, re-verify every processing cloudinary row on each
  // library load — a self-heal that needs no manual retry action. Best-effort
  // and cheap in practice (processing rows are the rare, transient minority).
  const videos = await Promise.all(
    rows.map(async (r) => {
      const healed = await reverifyProcessingVideo(r);
      const { provider: _provider, providerVideoId: _providerVideoId, ...safe } = r;
      return healed === 'ready' ? { ...safe, status: 'ready' as const } : safe;
    }),
  );

  return json({ videos }, 200);
}
