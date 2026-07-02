import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { displayWeight, unitLabel, type PlanWorkout } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  Button,
  CategoryTile,
  Divider,
  enterDown,
  enterUp,
  FLOATING_TAB_SPACE,
  HeroCard,
  PressableScale,
  Ring,
  Screen,
  SectionLabel,
  Tag,
} from '../../components/ui';
import { posterDate } from '../../lib/dates';
import { useProfile } from '../../state/profile';
import { StreakChip } from '../../features/engagement/components/StreakChip';
import { WeeklyCheckIn } from '../../features/engagement/components/WeeklyCheckIn';
import { useHomeData, type DoneToday } from '../../features/engagement/hooks';
import { avatarLetter, formatCompact, greetingForHour, toHref } from '../../features/engagement/logic';

/** Home — answers "what's today?" in one glance. */

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greet: { flex: 1 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingWrap: { marginBottom: spacing.lg },
  heroCard: { marginBottom: spacing.lg },
  /** The one big moment: workout name in huge condensed caps. */
  heroName: { fontSize: 48, lineHeight: 56, marginTop: -4 },
  volumeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  tileRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  tileCell: { flex: 1 },
  tileWide: { marginBottom: spacing.lg },
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  foodText: { flex: 1 },
  lastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
});

function Hero({
  planName,
  nextWorkout,
  doneToday,
  volume,
  unit,
}: {
  planName: string | null;
  nextWorkout: PlanWorkout | null;
  doneToday: DoneToday | null;
  /** Done-state volume, already converted to the display unit. */
  volume: number;
  unit: string;
}) {
  if (doneToday !== null) {
    return (
      <HeroCard mascot style={styles.heroCard}>
        <Tag label="✓ Done" variant="filled" />
        <AppText variant="label">{planName ?? 'Workout'}</AppText>
        <AppText variant="display" style={styles.heroName} numberOfLines={2}>
          {doneToday.name}
        </AppText>
        <View style={styles.volumeRow}>
          <AnimatedNumber value={volume} grouped variant="display" />
          <AppText variant="caption">{unit} volume</AppText>
        </View>
        {nextWorkout !== null ? (
          <Button
            label="Go again"
            variant="secondary"
            onPress={() => router.push(toHref(`/workout/start?planWorkoutId=${nextWorkout.id}`))}
          />
        ) : null}
      </HeroCard>
    );
  }

  if (nextWorkout === null) {
    return (
      <HeroCard mascot style={styles.heroCard}>
        <AppText variant="label">Next workout</AppText>
        <AppText variant="display" style={styles.heroName} numberOfLines={2}>
          No plan yet
        </AppText>
        <AppText variant="caption">Pick a plan to get your next workout here.</AppText>
        <Button label="Choose a plan" variant="secondary" onPress={() => router.push('/(tabs)/train')} />
      </HeroCard>
    );
  }

  return (
    <HeroCard mascot style={styles.heroCard}>
      <AppText variant="label">{planName ?? 'Next workout'}</AppText>
      <AppText variant="display" style={styles.heroName} numberOfLines={2}>
        {nextWorkout.name}
      </AppText>
      <AppText variant="caption">{nextWorkout.exercises.length} exercises</AppText>
      <Button
        label="Start workout"
        onPress={() => router.push(toHref(`/workout/start?planWorkoutId=${nextWorkout.id}`))}
      />
    </HeroCard>
  );
}

export default function HomeScreen() {
  const displayName = useProfile((s) => s.displayName);
  const planId = useProfile((s) => s.planId);
  const targets = useProfile((s) => s.targets);
  const unitPref = useProfile((s) => s.unitPref);
  const data = useHomeData(planId);

  const unit = unitLabel(unitPref);
  const last = data?.lastSession ?? null;

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterDown(0)} style={styles.topRow}>
        <View style={styles.avatar}>
          <AppText variant="bodyBold">{avatarLetter(displayName)}</AppText>
        </View>
        <View style={styles.greet}>
          <AppText variant="caption">{greetingForHour(new Date().getHours())}</AppText>
          <AppText variant="bodyBold" numberOfLines={1}>
            {displayName.trim() || 'Athlete'}
          </AppText>
        </View>
        {data !== null ? <StreakChip streak={data.streak} /> : null}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push(toHref('/settings'))}
          style={styles.iconBtn}
        >
          <Ionicons name="settings-outline" size={20} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <Animated.View entering={enterDown(1)} style={styles.headingWrap}>
        <AppText variant="label">{posterDate()}</AppText>
        <AppText variant="heading">Today</AppText>
      </Animated.View>

      {data !== null ? (
        <>
          <Animated.View entering={enterUp(0)}>
            <Hero
              planName={data.planName}
              nextWorkout={data.nextWorkout}
              doneToday={data.doneToday}
              volume={displayWeight(data.doneToday?.volumeKg ?? 0, unitPref)}
              unit={unit}
            />
          </Animated.View>

          <Animated.View entering={enterUp(1)} style={styles.tileRow}>
            <View style={styles.tileCell}>
              <CategoryTile
                title="Volume"
                value={formatCompact(displayWeight(data.weekVolumeKg, unitPref))}
                unit={unit}
                icon="barbell"
                color={colors.accent}
                deepColor={colors.accentDim}
              />
            </View>
            <View style={styles.tileCell}>
              <CategoryTile
                title="Sessions"
                value={data.weekSessions}
                icon="calendar"
                color={colors.blue}
                deepColor={colors.blueDeep}
              />
            </View>
          </Animated.View>
          <Animated.View entering={enterUp(2)} style={styles.tileWide}>
            <CategoryTile
              title="PRs"
              value={data.prCount}
              icon="trophy"
              color={colors.orange}
              deepColor={colors.orangeDeep}
              textColor={colors.onOrange}
            />
          </Animated.View>

          <WeeklyCheckIn stagger={3} />

          <Animated.View entering={enterUp(4)}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Food today: ${data.kcalEaten} of ${targets.kcal} kilocalories. Open Food`}
              onPress={() => router.push('/(tabs)/food')}
              style={styles.foodRow}
            >
              <Ring
                progress={targets.kcal > 0 ? data.kcalEaten / targets.kcal : 0}
                size={48}
                strokeWidth={5}
                color={colors.kcal}
                delay={350}
              />
              <View style={styles.foodText}>
                <AppText variant="bodyBold">Calories</AppText>
                <AppText variant="caption">
                  {data.kcalEaten} of {targets.kcal} kcal
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
            </PressableScale>
          </Animated.View>

          {last !== null ? (
            <Animated.View entering={enterUp(5)}>
              <SectionLabel>Last session</SectionLabel>
              <Divider />
              <View style={styles.lastRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {last.name}
                  </AppText>
                  <AppText variant="caption">{posterDate(last.date)}</AppText>
                </View>
                <AppText variant="caption">
                  {formatCompact(displayWeight(last.volumeKg, unitPref))} {unit} · {last.sets} sets
                </AppText>
              </View>
              <Divider />
            </Animated.View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
