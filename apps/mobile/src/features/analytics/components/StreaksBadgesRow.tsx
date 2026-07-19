import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BADGE_CATALOG } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, IconChip, PressableScale } from '../../../components/ui';
import { StreakChip } from '../../engagement/components/StreakChip';
import { useGamificationBadges } from '../../gamification/store';
import { useWeeklyStreak } from '../../streak/hooks';
import { useAuth } from '../../../state/auth';
import { useGamificationDisplay } from '../../../state/gamification';

/**
 * B20 fix — streaks & badges surfaced on the Progress tab, not just Home and
 * a buried Settings row. Self-contained: hydrates its own badge snapshot on
 * mount and renders nothing when signed out or when the member has turned
 * off achievements (design law 7 — "Hide achievements" suppresses XP/rank/
 * badges UI everywhere, this row included).
 */

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  streakWrap: { flexShrink: 0 },
  badgesPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
  },
  badgesText: { flex: 1 },
});

export function StreaksBadgesRow() {
  const authStatus = useAuth((s) => s.status);
  const hideGamification = useGamificationDisplay((s) => s.hideGamification);
  const streak = useWeeklyStreak();
  const badges = useGamificationBadges((s) => s.badges);
  const hydrate = useGamificationBadges((s) => s.hydrate);

  useEffect(() => {
    if (authStatus === 'signedIn') void hydrate();
  }, [authStatus, hydrate]);

  if (authStatus !== 'signedIn' || hideGamification) return null;

  const earnedCount = badges.filter((b) => !b.badgeId.startsWith('challenge:')).length;

  return (
    <View style={styles.row}>
      {streak !== null ? (
        <View style={styles.streakWrap}>
          <StreakChip streak={streak} />
        </View>
      ) : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${earnedCount} of ${BADGE_CATALOG.length} badges earned. View all badges`}
        onPress={() => router.push('/badges')}
        style={styles.badgesPill}
      >
        <IconChip icon="ribbon" size={32} />
        <AppText variant="bodyBold" style={styles.badgesText} numberOfLines={1}>
          {`${earnedCount}/${BADGE_CATALOG.length} badges`}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
      </PressableScale>
    </View>
  );
}
