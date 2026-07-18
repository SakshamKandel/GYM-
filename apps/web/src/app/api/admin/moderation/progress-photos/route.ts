import { accounts, progressPhotos } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { getVideoProvider, NotConfiguredError } from '@/lib/video';

export const runtime = 'nodejs';

/**
 * Admin console — progress_photos moderation (ADMIN-MASTER-PLAN §3 P1-9).
 * Member-captured photos (silver+ entitlement) are otherwise reviewable only by
 * the member themselves (GET /api/me/photos) or their own assigned coach
 * (GET /api/coach/clients/[userId]/photos, read-only). This gives
 * moderation.manage holders a cross-account queue + a removal path.
 *
 *  - GET → the most recent 100 photos across every account, newest takenOn
 *    first, each with a freshly-signed url (same never-cache contract as the
 *    member/coach twins). Rate-limited 30/min/admin — same minting-cost
 *    reasoning as those routes; capped at 100 rows (not 200) because every row
 *    costs one signing round trip.
 *
 * Guarded by requirePermission('moderation.manage').
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'moderation.manage');
  if (principal instanceof Response) return principal;

  const limited = rateLimit({
    route: 'admin/moderation/photos:list',
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
      account: { id: accounts.id, email: accounts.email, displayName: accounts.displayName },
    })
    .from(progressPhotos)
    .innerJoin(accounts, eq(accounts.id, progressPhotos.accountId))
    .orderBy(desc(progressPhotos.takenOn), desc(progressPhotos.createdAt))
    .limit(100);

  const provider = getVideoProvider();
  try {
    const photos = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        takenOn: r.takenOn,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        account: r.account,
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
