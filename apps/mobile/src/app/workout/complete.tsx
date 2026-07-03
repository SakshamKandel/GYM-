import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import type { SetLog, WorkoutLog } from '@gym/shared';
import { displayWeight, epley1Rm, hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  Button,
  enterDown,
  enterUp,
  Screen,
  SectionLabel,
  StatBlock,
} from '../../components/ui';
import { formatClock, formatWeightNumber, totalVolumeKg } from '../../features/training/logic';
import { replacePath } from '../../features/training/nav';
import { PrUpgradeCard } from '../../features/subscription/PrUpgradeCard';
import { getRepo } from '../../lib/repo';
import { useProfile } from '../../state/profile';

/** Editorial recap: duration · volume · sets, plus the PR ledger. */

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  prNumbers: { fontFamily: type.display, fontSize: 24, color: colors.text, flexShrink: 0 },
  prName: { flex: 1, minWidth: 0 },
  done: { marginTop: spacing.xxl },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
  // Each of the three recap stats gets an equal, shrinkable share of the row so
  // a big volume number can't push "sets" off the card edge.
  statCol: { flexShrink: 1, minWidth: 0 },
});

export default function WorkoutCompleteScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const unitPref = useProfile((s) => s.unitPref);
  const tier = useProfile((s) => s.tier);
  const [workout, setWorkout] = useState<WorkoutLog | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);

  useEffect(() => {
    if (typeof id !== 'string' || id.length === 0) return;
    let mounted = true;
    void (async () => {
      const repo = await getRepo();
      const [w, s] = await Promise.all([repo.getWorkout(id), repo.getSetsForWorkout(id)]);
      if (mounted) {
        setWorkout(w);
        setSets(s);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  const volume = Math.round(displayWeight(totalVolumeKg(sets), unitPref));
  const prSets = sets.filter((s) => s.isPr);

  // Below Gold + a fresh PR = the honest conversion moment. Quote their
  // strongest lift back to them (highest e1RM, heavier weight breaks ties).
  const showUpgrade = prSets.length > 0 && !hasEntitlement({ tier }, 'signature_plans');
  const topPrSet = showUpgrade
    ? prSets.reduce((best, s) => {
        const bestE1rm = epley1Rm(best.weightKg, best.reps);
        const e1rm = epley1Rm(s.weightKg, s.reps);
        if (e1rm > bestE1rm) return s;
        if (e1rm === bestE1rm && s.weightKg > best.weightKg) return s;
        return best;
      })
    : null;

  return (
    <Screen scroll>
      <Animated.View entering={enterDown(0)}>
        <AppText variant="label" color={colors.textDim}>
          {workout?.name ?? ''}
        </AppText>
        <AppText variant="heading">Workout complete</AppText>
      </Animated.View>

      <View style={styles.statsRow}>
        <Animated.View entering={enterUp(0)} style={styles.statCol}>
          <StatBlock label="time" value={formatClock(workout?.durationSec ?? 0)} />
        </Animated.View>
        <Animated.View entering={enterUp(1)} style={styles.statCol}>
          <AppText variant="label" numberOfLines={1}>volume</AppText>
          <View style={styles.statValueRow}>
            <AnimatedNumber value={volume} grouped variant="display" style={styles.statCol} />
            <AppText variant="caption" color={colors.textDim}>
              {unitPref}
            </AppText>
          </View>
        </Animated.View>
        <Animated.View entering={enterUp(2)} style={styles.statCol}>
          <StatBlock label="sets" value={sets.length} />
        </Animated.View>
      </View>

      {prSets.length > 0 ? (
        <>
          <Animated.View entering={enterUp(3)}>
            <SectionLabel>New records</SectionLabel>
          </Animated.View>
          {prSets.map((s, i) => (
            <Animated.View key={s.id} entering={enterUp(Math.min(4 + i, 8))} style={styles.prRow}>
              <AppText variant="bodyBold" numberOfLines={1} style={styles.prName}>
                {s.exerciseName}
              </AppText>
              <AppText style={styles.prNumbers} tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {`${formatWeightNumber(displayWeight(s.weightKg, unitPref))} ${unitPref} × ${s.reps}`}
              </AppText>
            </Animated.View>
          ))}
        </>
      ) : null}

      {topPrSet ? (
        <PrUpgradeCard
          topPr={{
            exerciseName: topPrSet.exerciseName,
            weightKg: topPrSet.weightKg,
            reps: topPrSet.reps,
            e1rm: epley1Rm(topPrSet.weightKg, topPrSet.reps),
          }}
          unit={unitPref}
        />
      ) : null}

      <Animated.View entering={enterUp(4)}>
        <Button
          label="Done"
          variant={showUpgrade ? 'secondary' : 'primary'}
          onPress={() => replacePath('/(tabs)')}
          style={styles.done}
        />
      </Animated.View>
    </Screen>
  );
}
