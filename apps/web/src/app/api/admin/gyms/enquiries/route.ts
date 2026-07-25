import { accounts, gymEnquiries, gyms } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin queue: member membership / day-pass enquiries about a gym listing.
 * Sibling of the report + review queues, gated on the same `gyms.manage`
 * permission that unlocks the gym editor. Open first (oldest first inside the
 * open block, so the longest-waiting lead surfaces); contacted/closed follow,
 * newest first — the same ordering contract the reports queue uses.
 *
 * `passId` points at an entry inside the gym's `pass_options` jsonb, so the
 * human-readable title is resolved here rather than shipping raw ids to the
 * console. An id that no longer matches any option (the admin edited the pass
 * list after the enquiry landed) degrades to null, not an error.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'gyms.manage');
  if (principal instanceof Response) return principal;

  const rows = await getDb()
    .select({
      id: gymEnquiries.id,
      gymId: gymEnquiries.gymId,
      gymName: gyms.name,
      gymSlug: gyms.slug,
      passId: gymEnquiries.passId,
      passOptions: gyms.passOptions,
      message: gymEnquiries.message,
      status: gymEnquiries.status,
      createdAt: gymEnquiries.createdAt,
      memberName: accounts.displayName,
      memberEmail: accounts.email,
    })
    .from(gymEnquiries)
    .innerJoin(gyms, eq(gyms.id, gymEnquiries.gymId))
    .innerJoin(accounts, eq(accounts.id, gymEnquiries.accountId))
    .orderBy(asc(gymEnquiries.status), asc(gymEnquiries.createdAt));

  const enquiries = rows.map(({ passOptions, passId, createdAt, ...rest }) => ({
    ...rest,
    passId,
    passTitle: passId ? (passOptions.find((p) => p.id === passId)?.title ?? null) : null,
    createdAt: createdAt.toISOString(),
  }));

  // 'closed' < 'contacted' < 'open' alphabetically, so SQL's asc(status) does
  // NOT put the actionable rows on top — re-rank explicitly: open first
  // (oldest first, so the longest-waiting lead leads), then contacted, then
  // closed, both newest first since those are history rather than a to-do.
  const RANK: Record<'open' | 'contacted' | 'closed', number> = { open: 0, contacted: 1, closed: 2 };
  enquiries.sort((a, b) => {
    if (a.status !== b.status) return RANK[a.status] - RANK[b.status];
    if (a.status === 'open') return a.createdAt.localeCompare(b.createdAt);
    return b.createdAt.localeCompare(a.createdAt);
  });

  return json({ enquiries }, 200);
}
