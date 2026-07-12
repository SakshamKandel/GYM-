import { progressPhotos } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Coach console — a client's progress photos (SCALE-UP-PLAN §4.5), read-only.
 * Guarded by requireCoachOwnsUser (super_admin/main_admin pass without an
 * assignment row, same as every other coach/clients/[userId] route) plus
 * requirePermission('coach.user.read'). Signed URLs are minted fresh per
 * request from the stored uid — never cached, mirrors /api/me/photos GET.
 * Rate-limited 30/min/coach — same minting-cost reasoning as that route.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const limited = rateLimit({
    route: 'coach/clients/photos:list',
    limit: 30,
    windowMs: 60 * 1000,
    accountId: principal.id,
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
    .where(eq(progressPhotos.accountId, userId))
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
