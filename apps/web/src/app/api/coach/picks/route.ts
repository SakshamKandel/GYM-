import { awardedBadges, coachPicks, xpEvents } from '@gym/db';
import { XP_AWARDS } from '@gym/shared';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Coach console — "Coach's pick": spotlight ONE assigned client per month.
 *
 *  - POST {userId} → inserts a coachPicks row (unique coachId+monthKey — one
 *    pick per coach per month, 409 {error:'already_picked'} on a repeat this
 *    month), awards the `coach_pick` badge (idempotent — awardedBadges unique
 *    on accountId+badgeId, so re-picking the SAME member across different
 *    months just re-triggers the push, never double-awards the badge) + its
 *    bounded badge XP, then pushes the member.
 */

const bodySchema = z.object({ userId: z.string().min(1).max(64) });

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { userId } = parsed.data;

  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const monthKey = currentMonthKey();
  const db = getDb();

  const inserted = await db
    .insert(coachPicks)
    .values({ coachId: principal.id, accountId: userId, monthKey })
    .onConflictDoNothing({ target: [coachPicks.coachId, coachPicks.monthKey] })
    .returning();
  if (inserted.length === 0) return json({ error: 'already_picked' }, 409);

  const badgeInserted = await db
    .insert(awardedBadges)
    .values({ accountId: userId, badgeId: 'coach_pick', status: 'logged' })
    .onConflictDoNothing({ target: [awardedBadges.accountId, awardedBadges.badgeId] })
    .returning({ id: awardedBadges.id });
  if (badgeInserted.length > 0) {
    await db
      .insert(xpEvents)
      .values({ accountId: userId, kind: 'badge', sourceKey: 'coach_pick', amount: XP_AWARDS.badge })
      .onConflictDoNothing({ target: [xpEvents.accountId, xpEvents.kind, xpEvents.sourceKey] });
  }

  after(() =>
    sendPushToAccount(userId, {
      title: "Coach's pick",
      body: 'Your coach picked you as this month’s spotlight member.',
      data: { type: 'badge_earned', badgeId: 'coach_pick' },
    }),
  );

  await logAudit(principal, 'coach.pick.award', 'account', userId, { monthKey });

  return json({ ok: true }, 200);
}
