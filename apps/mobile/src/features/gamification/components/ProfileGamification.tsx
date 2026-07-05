import { StyleSheet, View } from 'react-native';
import type { Rank } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { RankEmblem } from './RankEmblem';

/**
 * Small, restrained profile-card gamification strip: a colored level ring
 * around the avatar's outer edge, a sentence-case rank title, and a thin XP
 * progress bar. Personal-only surface (design law 5) — never shown on any
 * competitive screen. Returns null when hidden by the "Hide gamification"
 * settings toggle (design law 7) or before the server snapshot has loaded.
 *
 * Deliberately presentational: the profile screen already fetches the
 * gamification snapshot via useWeeklyStreak() (one network call, not two).
 */

const RANK_LABEL: Record<Rank, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const RANK_COLOR: Record<Rank, string> = {
  bronze: '#C58A4A',
  silver: '#9BA0A8',
  gold: '#E0B84A',
  elite: colors.accent,
};

export interface ProfileGamificationProps {
  hidden: boolean;
  profile: {
    level: number;
    xpIntoLevel: number;
    xpForNextLevel: number;
    rank: Rank;
  } | null;
}

export function ProfileGamification({ hidden, profile }: ProfileGamificationProps) {
  if (hidden || profile === null) return null;

  const ratio =
    profile.xpForNextLevel > 0
      ? Math.max(0, Math.min(1, profile.xpIntoLevel / profile.xpForNextLevel))
      : 0;
  const rankColor = RANK_COLOR[profile.rank];

  return (
    <View style={styles.row} accessible accessibilityLabel={`Level ${profile.level}, ${RANK_LABEL[profile.rank]} rank`}>
      <RankEmblem rank={profile.rank} level={profile.level} />
      <View style={styles.info}>
        <AppText variant="caption" color={rankColor} numberOfLines={1}>
          {RANK_LABEL[profile.rank]} · Level {profile.level}
        </AppText>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${ratio * 100}%`, backgroundColor: rankColor }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  info: { flex: 1, gap: 4, minWidth: 0 },
  barTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: radius.full,
  },
});
