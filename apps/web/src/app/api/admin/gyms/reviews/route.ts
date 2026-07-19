import { accounts, gymReviews, gyms } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin review-moderation queue (Pack C gym half — the "stop rendering
 * admin-authored social proof" fix pairs with giving admins a real hide/show
 * lever over the GENUINE reviews that replace it). Newest first, both
 * statuses included — the client splits into Visible/Hidden tabs. Gated on
 * `gyms.manage` (same permission as the report queue and the gym editor).
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({
      id: gymReviews.id,
      gymId: gymReviews.gymId,
      gymName: gyms.name,
      gymSlug: gyms.slug,
      stars: gymReviews.stars,
      note: gymReviews.note,
      status: gymReviews.status,
      createdAt: gymReviews.createdAt,
      authorEmail: accounts.email,
    })
    .from(gymReviews)
    .innerJoin(gyms, eq(gyms.id, gymReviews.gymId))
    .innerJoin(accounts, eq(accounts.id, gymReviews.accountId))
    .orderBy(desc(gymReviews.createdAt));

  const reviews = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  return json({ reviews }, 200);
}
