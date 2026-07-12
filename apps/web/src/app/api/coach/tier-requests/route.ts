import { coachProfiles, coachTierRequests } from '@gym/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireStaff } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach-requested seniority-tier upgrade (SCALE-UP-PLAN §1.4 / §4.2). A
 * seniority badge, not money — see coach_profiles.coachTier.
 *
 *  - POST {requestedTier:'gold'|'elite', note?} → one PENDING request per
 *    coach; must actually be an upgrade over the caller's CURRENT coachTier.
 *  - GET → the caller's own request history, newest first.
 *
 * Guarded by requireStaff + an explicit role==='coach' check (not
 * requirePermission — 'coach.wallet.read' would also let super_admin/
 * main_admin bypass through, but a tier-upgrade request only makes sense for
 * an actual coach_profiles row, so the role is checked directly here).
 */

const COACH_TIER_RANK: Record<'silver' | 'gold' | 'elite', number> = {
  silver: 1,
  gold: 2,
  elite: 3,
};

const postSchema = z.object({
  requestedTier: z.enum(['gold', 'elite']),
  note: z.string().trim().max(500).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;
  if (principal.role !== 'coach') return json({ error: 'forbidden' }, 403);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { requestedTier, note } = parsed.data;

  const db = getDb();

  const profile = await db
    .select({ coachTier: coachProfiles.coachTier })
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, principal.id))
    .limit(1);
  const currentTier = profile[0]?.coachTier ?? 'silver';

  if (COACH_TIER_RANK[requestedTier] <= COACH_TIER_RANK[currentTier]) {
    return json({ error: 'not_an_upgrade' }, 400);
  }

  const pending = await db
    .select({ id: coachTierRequests.id })
    .from(coachTierRequests)
    .where(
      and(eq(coachTierRequests.coachId, principal.id), eq(coachTierRequests.status, 'pending')),
    )
    .limit(1);
  if (pending.length > 0) return json({ error: 'already_pending' }, 409);

  const inserted = await db
    .insert(coachTierRequests)
    .values({ coachId: principal.id, requestedTier, note: note ?? '' })
    .returning({ id: coachTierRequests.id });

  const request = inserted[0];
  if (!request) return json({ error: 'invalid' }, 400);

  return json({ id: request.id }, 201);
}

export async function GET(req: Request) {
  const principal = await requireStaff(req);
  if (principal instanceof Response) return principal;
  if (principal.role !== 'coach') return json({ error: 'forbidden' }, 403);

  const rows = await getDb()
    .select({
      id: coachTierRequests.id,
      requestedTier: coachTierRequests.requestedTier,
      note: coachTierRequests.note,
      status: coachTierRequests.status,
      decidedAt: coachTierRequests.decidedAt,
      createdAt: coachTierRequests.createdAt,
    })
    .from(coachTierRequests)
    .where(eq(coachTierRequests.coachId, principal.id))
    .orderBy(desc(coachTierRequests.createdAt))
    .limit(50);

  return json({ requests: rows }, 200);
}
