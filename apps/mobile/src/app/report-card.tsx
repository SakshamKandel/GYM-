import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { displayWeight } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  StatBlock,
} from '../components/ui';
import { useGamificationBadges } from '../features/gamification/store';
import { useWeeklyStreak } from '../features/streak/hooks';
import { addDays, todayIso } from '../lib/dates';
import { getRepo } from '../lib/repo';
import { useAuth } from '../state/auth';
import { useProfile } from '../state/profile';

/**
 * /report-card — monthly recap (Pack O). New screen: sessions, volume, PRs
 * and badges earned in the trailing 30 days, plus the current streak, with
 * a native-Share export so a member can post their month somewhere else.
 * Pulled entirely from local SQLite (repo) + already-hydrated gamification
 * state — no new network surface needed.
 */

const WINDOW_DAYS = 30;

interface MonthStats {
  sessions: number;
  volumeKg: number;
  prCount: number;
}

const styles = StyleSheet.create({
  statsCard: { marginTop: spacing.lg },
  statsRow: { flexDirection: 'row' },
  statCell: { flex: 1, alignItems: 'center' },
  skeletons: { gap: spacing.md, marginTop: spacing.lg },
  shareBtn: { marginTop: spacing.xl },
  badgesLine: { marginTop: spacing.md },
});

export default function ReportCardScreen() {
  const authStatus = useAuth((s) => s.status);
  const unitPref = useProfile((s) => s.unitPref);
  const streak = useWeeklyStreak();
  const badges = useGamificationBadges((s) => s.badges);
  const [stats, setStats] = useState<MonthStats | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const repo = await getRepo();
      const today = todayIso();
      const from = addDays(today, -WINDOW_DAYS);
      const [workouts, sets] = await Promise.all([
        repo.getWorkoutsBetween(from, today),
        repo.getSetsBetween(from, today),
      ]);
      if (!mounted) return;
      const sessions = workouts.filter((w) => w.finishedAt !== null).length;
      const volumeKg = sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
      const prCount = sets.filter((s) => s.isPr).length;
      setStats({ sessions, volumeKg, prCount });
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const newBadgesCount = (() => {
    const cutoff = addDays(todayIso(), -WINDOW_DAYS);
    return badges.filter((b) => !b.badgeId.startsWith('challenge:') && b.earnedAt.slice(0, 10) >= cutoff).length;
  })();

  async function share(): Promise<void> {
    if (!stats) return;
    const volume = Math.round(displayWeight(stats.volumeKg, unitPref));
    const lines = [
      'My last 30 days:',
      `${stats.sessions} workouts`,
      `${volume.toLocaleString('en-US')} ${unitPref} lifted`,
      `${stats.prCount} new PR${stats.prCount === 1 ? '' : 's'}`,
    ];
    if (streak) lines.push(`${streak.weeks} week streak`);
    if (newBadgesCount > 0) lines.push(`${newBadgesCount} new badge${newBadgesCount === 1 ? '' : 's'}`);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User cancelled or share sheet failed — nothing to recover from here.
    }
  }

  return (
    <Screen scroll>
      <ScreenHeader eyebrow="Your last 30 days" title="Report card" />

      {authStatus !== 'signedIn' ? (
        <AppText variant="body" color={colors.textDim} style={styles.statsCard}>
          Sign in to see your recap.
        </AppText>
      ) : stats === null ? (
        <View style={styles.skeletons}>
          <Skeleton height={120} />
        </View>
      ) : (
        <>
          <Card style={styles.statsCard}>
            <View style={styles.statsRow}>
              <StatBlock
                label="Sessions"
                value={stats.sessions}
                size="stat"
                align="center"
                style={styles.statCell}
              />
              <StatBlock
                label="Volume"
                value={Math.round(displayWeight(stats.volumeKg, unitPref))}
                unit={unitPref}
                size="stat"
                align="center"
                style={styles.statCell}
              />
              <StatBlock
                label="New PRs"
                value={stats.prCount}
                size="stat"
                align="center"
                accent
                style={styles.statCell}
              />
            </View>
          </Card>

          <SectionLabel>Streak & badges</SectionLabel>
          <Card>
            <AppText variant="bodyBold">
              {streak ? `${streak.weeks} week streak` : 'No active streak yet'}
            </AppText>
            <AppText variant="caption" color={colors.textDim} style={styles.badgesLine}>
              {newBadgesCount > 0
                ? `${newBadgesCount} new badge${newBadgesCount === 1 ? '' : 's'} this month`
                : 'No new badges yet this month'}
            </AppText>
          </Card>

          <Button label="Share my month" onPress={() => void share()} style={styles.shareBtn} />
        </>
      )}
    </Screen>
  );
}
