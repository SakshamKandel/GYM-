import { accounts, awardedBadges, challengeMembers, coachChallenges, xpEvents } from '@gym/db';
import { BADGE_CATALOG } from '@gym/shared';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { GamificationManager } from './_components/GamificationManager';
import type { AwardedBadgeRow, ChallengeRow, XpCorrectionRow } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATALOG_NAME_BY_ID = new Map(BADGE_CATALOG.map((b) => [b.id, b.name]));

/** 'yyyy-mm' for the current month — matches coachChallenges.monthKey's format
 * (mirrors the `currentMonthKey()` helper duplicated across the coach/member
 * challenge routes; UTC is fine here since monthKey itself is a plain UTC
 * calendar-month string, not a KTM-cutoff boundary). */
function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Admin gamification oversight (gap build P2-17): XP corrections, badge
 * revoke, challenge moderation. Gated on `gamification.manage`, which sits
 * in NO sub-role preset (super_admin/main_admin only, per permissions.ts) —
 * this page is reachable only by top admins. Linked from the admin nav
 * (admin/layout.tsx NAV_ITEMS) behind the same permission.
 */

async function loadRecentCorrections(): Promise<XpCorrectionRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: xpEvents.id,
      accountId: xpEvents.accountId,
      accountEmail: accounts.email,
      accountName: accounts.displayName,
      amount: xpEvents.amount,
      createdAt: xpEvents.createdAt,
    })
    .from(xpEvents)
    .leftJoin(accounts, eq(accounts.id, xpEvents.accountId))
    .where(eq(xpEvents.kind, 'admin_correction'))
    .orderBy(desc(xpEvents.createdAt))
    .limit(50);

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

async function loadRecentBadges(): Promise<AwardedBadgeRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: awardedBadges.id,
      accountId: awardedBadges.accountId,
      accountEmail: accounts.email,
      accountName: accounts.displayName,
      badgeId: awardedBadges.badgeId,
      status: awardedBadges.status,
      earnedAt: awardedBadges.earnedAt,
    })
    .from(awardedBadges)
    .innerJoin(accounts, eq(accounts.id, awardedBadges.accountId))
    .orderBy(desc(awardedBadges.earnedAt))
    .limit(50);

  return rows.map((r) => ({
    ...r,
    badgeName: CATALOG_NAME_BY_ID.get(r.badgeId) ?? r.badgeId,
    earnedAt: r.earnedAt.toISOString(),
  }));
}

async function loadChallenges(): Promise<ChallengeRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: coachChallenges.id,
      coachId: coachChallenges.coachId,
      coachEmail: accounts.email,
      coachName: accounts.displayName,
      title: coachChallenges.title,
      monthKey: coachChallenges.monthKey,
      targetDays: coachChallenges.targetDays,
      createdAt: coachChallenges.createdAt,
    })
    .from(coachChallenges)
    .innerJoin(accounts, eq(accounts.id, coachChallenges.coachId))
    .orderBy(desc(coachChallenges.monthKey), desc(coachChallenges.createdAt));

  const ids = rows.map((r) => r.id);
  const memberCountMap = new Map<string, number>();
  if (ids.length > 0) {
    const memberRows = await getDb()
      .select({ challengeId: challengeMembers.challengeId, n: count() })
      .from(challengeMembers)
      .where(inArray(challengeMembers.challengeId, ids))
      .groupBy(challengeMembers.challengeId);
    for (const r of memberRows) memberCountMap.set(r.challengeId, Number(r.n));
  }

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    memberCount: memberCountMap.get(r.id) ?? 0,
  }));
}

export default async function AdminGamificationPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('gamification.manage')) redirect('/admin');

  const [corrections, badges, challenges] = await Promise.all([
    loadRecentCorrections(),
    loadRecentBadges(),
    loadChallenges(),
  ]);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Gamification oversight"
        subtitle="XP corrections, badge revocation, and coach challenge moderation."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Corrections (50 most recent)" value={corrections.length} />
        <StatTile label="Badges (50 most recent)" value={badges.length} />
        <StatTile
          label="Active challenges"
          value={challenges.filter((c) => c.monthKey === currentMonthKey()).length}
          hint={`of ${challenges.length} total`}
        />
      </div>

      <GamificationManager corrections={corrections} badges={badges} challenges={challenges} />
    </div>
  );
}
