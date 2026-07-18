import { accounts, referrals, trialUsage } from '@gym/db';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import type { AbuseDashboard } from './_components/types';

/**
 * Shared aggregate query for the referral/trial abuse dashboard (P2-18) —
 * used by both `page.tsx` (initial server render) and
 * `GET /api/admin/abuse` (the same data over the wire, for a client refresh
 * after a trial reset) so the two never drift. See the API route for the
 * full contract doc (permission choice, what "multi-trial" and the
 * same-device limitation mean).
 */
export async function loadAbuseDashboard(): Promise<AbuseDashboard> {
  const db = getDb();

  const referralStatusRows = await db
    .select({ status: referrals.status, n: count() })
    .from(referrals)
    .groupBy(referrals.status);
  const referralCounts = { pending: 0, joined: 0, rewarded: 0 };
  for (const r of referralStatusRows) {
    if (r.status in referralCounts) referralCounts[r.status as keyof typeof referralCounts] = Number(r.n);
  }
  const referralTotal = referralCounts.pending + referralCounts.joined + referralCounts.rewarded;

  const topReferrerRows = await db
    .select({
      referrerId: referrals.referrerId,
      email: accounts.email,
      displayName: accounts.displayName,
      totalCount: count(),
    })
    .from(referrals)
    .innerJoin(accounts, eq(accounts.id, referrals.referrerId))
    .groupBy(referrals.referrerId, accounts.email, accounts.displayName)
    .orderBy(desc(count()))
    .limit(20);

  const rewardedRows = await db
    .select({ referrerId: referrals.referrerId, n: count() })
    .from(referrals)
    .where(eq(referrals.status, 'rewarded'))
    .groupBy(referrals.referrerId);
  const rewardedByReferrer = new Map(rewardedRows.map((r) => [r.referrerId, Number(r.n)]));

  const topReferrers = topReferrerRows.map((r) => ({
    referrerId: r.referrerId,
    email: r.email,
    displayName: r.displayName,
    totalCount: Number(r.totalCount),
    rewardedCount: rewardedByReferrer.get(r.referrerId) ?? 0,
  }));

  const trialTierRows = await db
    .select({ tier: trialUsage.tier, n: count() })
    .from(trialUsage)
    .groupBy(trialUsage.tier);
  const trialByTier = { silver: 0, gold: 0, elite: 0 };
  for (const r of trialTierRows) {
    if (r.tier in trialByTier) trialByTier[r.tier as keyof typeof trialByTier] = Number(r.n);
  }
  const trialTotal = trialByTier.silver + trialByTier.gold + trialByTier.elite;

  const perAccountTierRows = await db
    .select({ accountId: trialUsage.accountId, tier: trialUsage.tier })
    .from(trialUsage);
  const tiersByAccount = new Map<string, string[]>();
  for (const r of perAccountTierRows) {
    const list = tiersByAccount.get(r.accountId) ?? [];
    list.push(r.tier);
    tiersByAccount.set(r.accountId, list);
  }
  const multiTrialAccountIds = [...tiersByAccount.entries()]
    .filter(([, tiers]) => tiers.length > 1)
    .map(([accountId]) => accountId);

  let multiTrialAccounts: AbuseDashboard['trials']['multiTrialAccounts'] = [];
  if (multiTrialAccountIds.length > 0) {
    const identityRows = await db
      .select({ id: accounts.id, email: accounts.email, displayName: accounts.displayName })
      .from(accounts)
      .where(inArray(accounts.id, multiTrialAccountIds));
    multiTrialAccounts = identityRows.map((a) => ({
      accountId: a.id,
      email: a.email,
      displayName: a.displayName,
      tiersTrialed: tiersByAccount.get(a.id) ?? [],
    }));
  }

  const recentTrialRows = await db
    .select({
      accountId: trialUsage.accountId,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: trialUsage.tier,
      startedAt: trialUsage.startedAt,
      expiresAt: trialUsage.expiresAt,
    })
    .from(trialUsage)
    .innerJoin(accounts, eq(accounts.id, trialUsage.accountId))
    .orderBy(desc(trialUsage.startedAt))
    .limit(50);

  return {
    referrals: { total: referralTotal, ...referralCounts, topReferrers },
    trials: {
      total: trialTotal,
      byTier: trialByTier,
      multiTrialAccounts,
      recentTrials: recentTrialRows.map((r) => ({
        accountId: r.accountId,
        email: r.email,
        displayName: r.displayName,
        tier: r.tier,
        startedAt: r.startedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      })),
    },
    limitations: [
      'No device fingerprint or IP is captured on accounts or trial_usage — same-device multi-account detection is not available from stored data.',
    ],
  };
}
