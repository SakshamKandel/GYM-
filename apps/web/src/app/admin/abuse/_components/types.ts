export interface TopReferrerRow {
  referrerId: string;
  email: string;
  displayName: string;
  totalCount: number;
  rewardedCount: number;
}

export interface MultiTrialAccountRow {
  accountId: string;
  email: string;
  displayName: string;
  tiersTrialed: string[];
}

export interface RecentTrialRow {
  accountId: string;
  email: string;
  displayName: string;
  tier: 'silver' | 'gold' | 'elite';
  startedAt: string;
  expiresAt: string;
}

export interface AbuseDashboard {
  referrals: {
    total: number;
    pending: number;
    joined: number;
    rewarded: number;
    topReferrers: TopReferrerRow[];
  };
  trials: {
    total: number;
    byTier: { silver: number; gold: number; elite: number };
    multiTrialAccounts: MultiTrialAccountRow[];
    recentTrials: RecentTrialRow[];
  };
  limitations: string[];
}
