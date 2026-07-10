import { StyleSheet, View } from 'react-native';
import type { Rank } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { METAL_RAMP } from '../../../components/ui/badges/achievementMetals';
import { AppText } from '../../../components/ui';
import { RankEmblem } from './RankEmblem';

/**
 * Small, restrained profile-card gamification strip: the metal rank emblem,
 * an uppercase Oswald rank line (block-language micro-label), and a thick
 * rounded XP bar (brief §7). Personal-only surface (design law 5) — never
 * shown on any competitive screen. Returns null when hidden by the "Hide
 * gamification" settings toggle (design law 7) or before the server snapshot
 * has loaded.
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

// Feature-local rank identity colors — sourced from the shared earned-metal
// ramps (achievementMetals.ts) so no raw hex lives in this component; elite
// stays the brand accent, matching the elite ring.
const RANK_COLOR: Record<Rank, string> = {
  bronze: METAL_RAMP.bronze[1],
  silver: METAL_RAMP.silver[1],
  gold: METAL_RAMP.gold[1],
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
        <AppText variant="label" color={rankColor} tabular numberOfLines={1}>
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
  info: { flex: 1, gap: spacing.xs, minWidth: 0 },
  // Thick rounded bar (brief §7): 8px, full-pill, surfaceRaised track on dark.
  barTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.full,
  },
});
