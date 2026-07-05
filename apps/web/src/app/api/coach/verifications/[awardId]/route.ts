import { awardedBadges } from '@gym/db';
import { BADGE_CATALOG, STRENGTH_BADGE_IDS } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — one-click verify a member's logged strength-club badge.
 *
 *  - POST {action:'verify'} → status 'verified', verifiedBy/At stamped, then
 *    a 'badge_verified' push. The owning member comes from the ROW (never the
 *    request), guarded by requireCoachOwnsUser so a coach can only verify
 *    badges belonging to their own assigned clients.
 */

const bodySchema = z.object({ action: z.literal('verify') });

const BADGE_NAME: Record<string, string> = Object.fromEntries(BADGE_CATALOG.map((b) => [b.id, b.name]));

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ awardId: string }> }) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { awardId } = await params;

  const db = getDb();
  const rows = await db
    .select({ id: awardedBadges.id, accountId: awardedBadges.accountId, badgeId: awardedBadges.badgeId, status: awardedBadges.status })
    .from(awardedBadges)
    .where(eq(awardedBadges.id, awardId))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: 'not_found' }, 404);

  // Coach verification is a strength-club-only concept (design law 6) — a
  // coach must never be able to stamp "verified" onto a non-strength badge
  // (buddy_quest, coach_pick, consistency badges, challenge:* extras), which
  // would corrupt the meaning of the coach-verified checkmark shown to
  // members. Mirrors the GET queue's own STRENGTH_BADGE_IDS filter.
  if (!STRENGTH_BADGE_IDS.includes(row.badgeId)) {
    return json({ error: 'not_verifiable' }, 400);
  }

  if (!(await requireCoachOwnsUser(principal, row.accountId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  if (row.status !== 'verified') {
    await db
      .update(awardedBadges)
      .set({ status: 'verified', verifiedBy: principal.id, verifiedAt: new Date() })
      .where(eq(awardedBadges.id, awardId));
  }

  const badgeName = BADGE_NAME[row.badgeId] ?? row.badgeId;
  after(() =>
    sendPushToAccount(row.accountId, {
      title: 'Badge verified',
      body: `Your coach verified your ${badgeName} badge.`,
      data: { type: 'badge_verified', badgeId: row.badgeId },
    }),
  );

  await logAudit(principal, 'coach.badge.verify', 'awarded_badge', awardId, {
    userId: row.accountId,
    badgeId: row.badgeId,
  });

  return json({ ok: true }, 200);
}
