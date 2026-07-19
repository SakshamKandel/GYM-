import {
  accounts,
  checkIns,
  coachAssignments,
  gamificationProfiles,
  syncedSets,
  syncedWorkouts,
} from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the client-detail OVERVIEW (Pack K client-data dashboard).
 * One bounded aggregate query set over the account-scoped server data
 * (synced_workouts / synced_sets / check_ins / gamification_profiles) — the
 * headline a coach needs before they open training/nutrition/weight detail:
 * identity + effective tier, assignment start, 30-day training volume, lifetime
 * PR count, latest bodyweight, and the cached weekly streak.
 *
 * Guards (fail closed): requirePermission('coach.user.read') +
 * requireCoachOwnsUser(userId) → 403 without an ACTIVE assignment (super_admin/
 * main_admin pass without one). No member free text is returned here.
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

  const db = getDb();

  const acctRows = await db
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
      country: accounts.country,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .limit(1);
  const acct = acctRows[0];
  if (!acct) return json({ error: 'not_found' }, 404);

  // 30-day window (ISO date) for the recent-training figures. ranked=true only
  // — flagged/implausible workouts are excluded from every credited stat.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);

  const [assignRow] = await db
    .select({ assignedAt: coachAssignments.createdAt })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.userId, userId),
        eq(coachAssignments.coachId, principal.id),
        eq(coachAssignments.status, 'active'),
      ),
    )
    .limit(1);

  const [workoutAgg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last30: sql<number>`count(*) filter (where ${syncedWorkouts.date} >= ${sinceDate})::int`,
      lastAt: sql<Date | null>`max(${syncedWorkouts.finishedAt})`,
    })
    .from(syncedWorkouts)
    .where(and(eq(syncedWorkouts.accountId, userId), eq(syncedWorkouts.ranked, true)));

  const [setAgg] = await db
    .select({
      prCount: sql<number>`count(*) filter (where ${syncedSets.isPr} = true)::int`,
      volume30: sql<number>`coalesce(sum(${syncedSets.weightKg} * ${syncedSets.reps}) filter (where ${syncedSets.loggedAt} >= ${since}), 0)`,
    })
    .from(syncedSets)
    .where(eq(syncedSets.accountId, userId));

  const [checkinAgg] = await db
    .select({
      count: sql<number>`count(*)::int`,
      lastDate: sql<string | null>`max(${checkIns.date})`,
    })
    .from(checkIns)
    .where(eq(checkIns.accountId, userId));

  const [latestBw] = await db
    .select({ date: checkIns.date, bodyweightKg: checkIns.bodyweightKg })
    .from(checkIns)
    .where(and(eq(checkIns.accountId, userId), sql`${checkIns.bodyweightKg} is not null`))
    .orderBy(desc(checkIns.date))
    .limit(1);

  const [gam] = await db
    .select({
      xpTotal: gamificationProfiles.xpTotal,
      streakWeeks: gamificationProfiles.streakWeeks,
      bestStreakWeeks: gamificationProfiles.bestStreakWeeks,
      weeklyTargetDays: gamificationProfiles.weeklyTargetDays,
    })
    .from(gamificationProfiles)
    .where(eq(gamificationProfiles.accountId, userId))
    .limit(1);

  return json(
    {
      client: {
        id: acct.id,
        displayName: acct.displayName,
        email: acct.email,
        tier: effectiveTier(acct.tier, acct.tierExpiresAt, new Date()),
        tierExpiresAt: acct.tierExpiresAt,
        status: acct.status,
        country: acct.country,
        memberSince: acct.createdAt,
        assignedAt: assignRow?.assignedAt ?? null,
      },
      training: {
        totalSessions: workoutAgg?.total ?? 0,
        sessionsLast30: workoutAgg?.last30 ?? 0,
        volumeLast30Kg: Math.round(Number(setAgg?.volume30 ?? 0)),
        prCount: setAgg?.prCount ?? 0,
        lastWorkoutAt: workoutAgg?.lastAt ?? null,
      },
      body: {
        latestBodyweightKg: latestBw?.bodyweightKg ?? null,
        latestBodyweightDate: latestBw?.date ?? null,
        checkInCount: checkinAgg?.count ?? 0,
        lastCheckInDate: checkinAgg?.lastDate ?? null,
      },
      engagement: {
        xpTotal: gam?.xpTotal ?? 0,
        streakWeeks: gam?.streakWeeks ?? 0,
        bestStreakWeeks: gam?.bestStreakWeeks ?? 0,
        weeklyTargetDays: gam?.weeklyTargetDays ?? null,
      },
    },
    200,
  );
}
