import { progressPhotos } from '@gym/db';
import { hasEntitlement, maskPii, minTierFor } from '@gym/shared';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Member progress photos (SCALE-UP-PLAN §4.5). Gated on the pre-existing
 * `progress_photos` Feature (silver+) — same server-side 403 shape the video
 * routes use, so the mobile UpgradePrompt pattern works unchanged.
 *
 * Storage: every progress photo is reserved via POST /api/uploads/image
 * {kind:'progress_photo'} — always Cloudinary access:'authenticated', which
 * never returns a public deliveryUrl, only a `uid`. `progress_photos.imageUrl`
 * stores that uid; GET mints a fresh signed URL per row per request via
 * signedImageUrl (same never-cache contract as plan-video playback).
 *
 *  - GET  → own photos, newest takenOn first, each with a freshly-signed url.
 *          Rate-limited 30/min/account — every row mints a fresh signed
 *          Cloudinary URL, so this is a minting cost, not a free read.
 *  - POST {takenOn, uid, note?} → insert one row (DB assigns the id). `note`
 *          is free member text, masked via maskPii before storage — same
 *          in-app-contact-only policy as coach_milestones.note.
 */

const postSchema = z.object({
  takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // The `uid` returned by POST /api/uploads/image {kind:'progress_photo'} —
  // that kind is always access:'authenticated', so the reservation never
  // hands back a deliveryUrl, only this uid. The server (CloudinaryProvider)
  // always mints uids as `progress_photo/<v4-uuid>`; enforcing that exact
  // shape here stops a client from storing an uid from a DIFFERENT folder
  // (e.g. a leaked `payment_receipt/<uuid>`) and later getting it signed
  // through this route — this is a minimum bound, not full ownership
  // binding (see review note on this route).
  uid: z
    .string()
    .trim()
    .regex(/^progress_photo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  note: z.string().trim().max(300).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  if (!hasEntitlement(user, 'progress_photos')) {
    return json({ error: 'locked', requiredTier: minTierFor('progress_photos') }, 403);
  }

  const limited = rateLimit({
    route: 'me/photos:list',
    limit: 30,
    windowMs: 60 * 1000,
    accountId: user.id,
  });
  if (limited) return limited;

  const rows = await getDb()
    .select({
      id: progressPhotos.id,
      takenOn: progressPhotos.takenOn,
      imageUrl: progressPhotos.imageUrl,
      note: progressPhotos.note,
      createdAt: progressPhotos.createdAt,
    })
    .from(progressPhotos)
    .where(eq(progressPhotos.accountId, user.id))
    .orderBy(desc(progressPhotos.takenOn), desc(progressPhotos.createdAt));

  const provider = getVideoProvider();
  try {
    const photos = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        takenOn: r.takenOn,
        note: r.note,
        createdAt: r.createdAt,
        url: await provider.signedImageUrl(r.imageUrl),
      })),
    );
    return json({ photos }, 200);
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return json({ error: 'image_not_configured' }, 503);
    }
    throw err;
  }
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  if (!hasEntitlement(user, 'progress_photos')) {
    return json({ error: 'locked', requiredTier: minTierFor('progress_photos') }, 403);
  }

  const limited = rateLimit({
    route: 'me/photos',
    limit: 30,
    windowMs: 60 * 60 * 1000,
    accountId: user.id,
  });
  if (limited) return limited;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { takenOn, uid, note } = parsed.data;

  const inserted = await getDb()
    .insert(progressPhotos)
    .values({ accountId: user.id, takenOn, imageUrl: uid, note: note ? maskPii(note) : '' })
    .returning({
      id: progressPhotos.id,
      takenOn: progressPhotos.takenOn,
      note: progressPhotos.note,
      createdAt: progressPhotos.createdAt,
    });

  const row = inserted[0];
  if (!row) return json({ error: 'invalid' }, 400);

  // Best-effort signed URL on the create response — if the provider becomes
  // unconfigured between the upload reservation and this call, the row still
  // saves fine; the client just re-fetches GET later once it's configured.
  let url: string | null = null;
  try {
    url = await getVideoProvider().signedImageUrl(uid);
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) throw err;
  }

  return json({ photo: { ...row, url } }, 201);
}
