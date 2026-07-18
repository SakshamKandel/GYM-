export interface XpCorrectionRow {
  id: string;
  accountId: string;
  accountEmail: string | null;
  accountName: string | null;
  amount: number;
  createdAt: string;
}

export interface AwardedBadgeRow {
  id: string;
  accountId: string;
  accountEmail: string;
  accountName: string;
  badgeId: string;
  badgeName: string;
  status: 'logged' | 'verified';
  earnedAt: string;
}

export interface ChallengeRow {
  id: string;
  coachId: string;
  coachEmail: string;
  coachName: string;
  title: string;
  monthKey: string;
  targetDays: number;
  createdAt: string;
  memberCount: number;
}
