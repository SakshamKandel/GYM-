import { admins } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Single upload-reservation endpoint for every image kind in the app
 * (SCALE-UP-PLAN §4.5). Mirrors the video reservation flow: the browser
 * uploads bytes straight to Cloudinary using the returned `uploadUrl`/`fields`
 * (never through Vercel), then hands `uid` (or `deliveryUrl` for public kinds)
 * to the owning API (coach-applications, /api/me/photos,
 * /api/payments/requests, /api/coach/profile, coach-authored exercise/diet
 * items).
 *
 * Authorization is per-kind:
 *  - progress_photo, payment_receipt, application_avatar → any signed-in
 *    member (an "open application intent" is enough for application_avatar —
 *    it's used BEFORE the account has a coach_applications row).
 *  - coach_avatar, custom_exercise, diet_item → the caller must already hold
 *    admins.role='coach' (queried fresh — never trusted from the JWT/session
 *    shape, since roles can change between requests).
 *
 * Access mode per kind decides the Cloudinary storage type: authenticated
 * (progress_photo, payment_receipt — never public) vs public (everything
 * else — avatars/exercise/diet images are meant to be openly rendered).
 *
 * Rate-limited 20/hour/account. 503 { error: 'image_not_configured' } when
 * the image-capable provider (Cloudinary) isn't configured.
 */

const IMAGE_KINDS = [
  'progress_photo',
  'payment_receipt',
  'application_avatar',
  'coach_avatar',
  'custom_exercise',
  'diet_item',
] as const;
type ImageKind = (typeof IMAGE_KINDS)[number];

/** Kinds any signed-in member may reserve an upload for — no staff role needed. */
const MEMBER_KINDS = new Set<ImageKind>([
  'progress_photo',
  'payment_receipt',
  'application_avatar',
]);

/** Cloudinary storage access mode per kind — see module doc comment above. */
const ACCESS_BY_KIND: Record<ImageKind, 'public' | 'authenticated'> = {
  progress_photo: 'authenticated',
  payment_receipt: 'authenticated',
  application_avatar: 'public',
  coach_avatar: 'public',
  custom_exercise: 'public',
  diet_item: 'public',
};

const bodySchema = z.object({ kind: z.enum(IMAGE_KINDS) });

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'uploads/image',
    limit: 20,
    windowMs: 60 * 60 * 1000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { kind } = parsed.data;

  if (!MEMBER_KINDS.has(kind)) {
    const rows = await getDb()
      .select({ role: admins.role })
      .from(admins)
      .where(eq(admins.accountId, user.id))
      .limit(1);
    if (rows[0]?.role !== 'coach') return json({ error: 'forbidden' }, 403);
  }

  try {
    const reservation = await getVideoProvider().createImageUpload({
      kind,
      access: ACCESS_BY_KIND[kind],
    });
    return json(
      {
        uploadUrl: reservation.uploadUrl,
        fields: reservation.fields,
        uid: reservation.uid,
        deliveryUrl: reservation.deliveryUrl,
      },
      201,
    );
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return json({ error: 'image_not_configured' }, 503);
    }
    throw err;
  }
}
