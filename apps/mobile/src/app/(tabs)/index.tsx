import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { displayWeight, hasEntitlement, unitLabel, type PlanWorkout, type Tier } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AITipCard,
  AnimatedNumber,
  AnimatedTierRing,
  AppText,
  Button,
  Divider,
  enterDown,
  enterFade,
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
import { useAiTip } from '../../lib/ai/useAiTip';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { CheckInCard } from '../../features/checkin/components/CheckInCard';
import { FirstWorkoutsQuest } from '../../features/engagement/components/FirstWorkoutsQuest';
import {
  PrDetail,
  SessionsDetail,
  StatTile,
  VolumeDetail,
} from '../../features/engagement/components/StatDetailSheets';
import { StreakChip } from '../../features/engagement/components/StreakChip';
import { WeeklyCheckIn } from '../../features/engagement/components/WeeklyCheckIn';
import { openLastSession, pushHistory } from '../../features/history/nav';
import { useHomeData, useQuestProgress, type DoneToday } from '../../features/engagement/hooks';
import { avatarLetter, formatCompact, greetingForHour, toHref } from '../../features/engagement/logic';
import { useWeeklyStreak } from '../../features/streak/hooks';
import { useQuest } from '../../state/quest';

/** Home — answers "what's today?" in one glance. */

/** Newie/mascot avatar — the coach entry reads as "from Greece", not the system. */
const NEWIE = require('../../../assets/images/newie.png');

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
  questWrap: { marginBottom: spacing.lg },
  // Prominent coach entry — surface row with the Newie avatar, sits right below
  // the heading so "message Greece" is the first thing after the greeting.
  coachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  coachAvatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  coachText: { flex: 1, gap: 2 },
  // Trailing lock affordance for the gated (non-Elite) state: Elite tag + lock.
  coachLocked: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroCard: { marginBottom: spacing.lg },
  /** The one big moment: workout name in huge condensed caps. */
  heroName: { fontSize: 48, lineHeight: 56, marginTop: -4 },
  volumeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  tileRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  tileCell: { flex: 1 },
  tileWide: { marginBottom: spacing.lg },
  tipCard: { marginBottom: spacing.lg },
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
  // Right-aligned meta must not be pushed off-screen by a long session name.
  lastMeta: { flexShrink: 0, textAlign: 'right' },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touch.min,
    paddingVertical: spacing.sm,
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

/**
 * Prominent Home entry into the 1-on-1 coach chat. Elite unlocks the thread and
 * taps through to /coach-chat; lower tiers see an Elite lock and route to plans.
 */
function CoachEntry({ tier }: { tier: Tier }) {
  const unlocked = hasEntitlement({ tier }, 'coach_chat');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        unlocked ? 'Chat with Greece, your one on one coach' : 'Chat with Greece — Elite plan'
      }
      onPress={() => router.push(unlocked ? toHref('/coach-chat') : toHref('/subscribe'))}
      style={styles.coachCard}
    >
      <Image source={NEWIE} style={styles.coachAvatar} contentFit="cover" contentPosition="top" accessibilityElementsHidden />
      <View style={styles.coachText}>
        <AppText variant="bodyBold" numberOfLines={1}>
          Chat with Greece
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          Your 1-on-1 coach, ready when you are
        </AppText>
      </View>
      {unlocked ? (
        <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
      ) : (
        <View style={styles.coachLocked}>
          <Tag label="Elite" variant="dim" />
          <Ionicons name="lock-closed" size={14} color={colors.textFaint} />
        </View>
      )}
    </PressableScale>
  );
}

export default function HomeScreen() {
  const displayName = useProfile((s) => s.displayName);
  const planId = useProfile((s) => s.planId);
  const targets = useProfile((s) => s.targets);
  const unitPref = useProfile((s) => s.unitPref);
  const goalType = useProfile((s) => s.goalType);
  const startWeightKg = useProfile((s) => s.startWeightKg);
  const targetWeightKg = useProfile((s) => s.targetWeightKg);
  const tier = useProfile((s) => s.tier);
  // Server-authoritative tier for the greeting ring — never useProfile.tier
  // (local upgrade-only mirror, known to drift above the server's value).
  const serverTier = useAuth((s) => s.user?.tier ?? 'starter');
  const data = useHomeData(planId);
  const weeklyStreak = useWeeklyStreak();
  const quest = useQuestProgress();
  const questDismissed = useQuest((s) => s.dismissed);

  const unit = unitLabel(unitPref);
  const last = data?.lastSession ?? null;
  const showQuest = quest !== null && !quest.expired && !questDismissed;

  const { state: tipState, refresh } = useAiTip(() => {
    const streak = weeklyStreak?.weeks ?? 0;
    const weekSessions = data?.weekSessions ?? 0;
    const goal = goalType ?? 'muscle';
    const bodyWeight =
      startWeightKg != null ? `${displayWeight(startWeightKg, unitPref)} ${unit}` : 'unknown';
    const goalWeight =
      targetWeightKg != null ? `${displayWeight(targetWeightKg, unitPref)} ${unit}` : 'unset';

    return [
      {
        role: 'system' as const,
        content:
          "You are an energetic gym coach who shares ONE surprising, TRUE fitness fact each time — fascinating, motivating, and specific. Whenever you can, tie the fact to the athlete's bodyweight or goal (e.g. calories a body their size burns, how much muscle they carry, strength-to-bodyweight feats, what moving their bodyweight achieves). Keep it under 35 words, upbeat, and always a fresh, different fact. No medical, diet, or weight-loss advice — keep it fun, factual, and about training and the body.",
      },
      {
        role: 'user' as const,
        content: `My bodyweight is ${bodyWeight}. Goal weight: ${goalWeight}. Goal: ${goal}. This week: ${weekSessions} sessions, ${streak}-week streak. Share one amazing fitness fact, tied to my bodyweight or training when you can.`,
      },
    ];
  }, [weeklyStreak?.weeks, data?.weekSessions, goalType, startWeightKg, targetWeightKg, unitPref, unit]);

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterDown(0)} style={styles.topRow}>
        {/* Home greeting is a premium surface — the animated tier ring runs
            here too, subtle at 44px (glow escapes the bounds, layout holds). */}
        <AnimatedTierRing tier={serverTier} size={44}>
          <View style={styles.avatar}>
            <AppText variant="bodyBold">{avatarLetter(displayName)}</AppText>
          </View>
        </AnimatedTierRing>
        <View style={styles.greet}>
          <AppText variant="caption">{greetingForHour(new Date().getHours())}</AppText>
          <AppText variant="bodyBold" numberOfLines={1}>
            {displayName.trim() || 'Athlete'}
          </AppText>
        </View>
        {weeklyStreak !== null ? <StreakChip streak={weeklyStreak} /> : null}
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

      <Animated.View entering={enterUp(0)}>
        <CoachEntry tier={tier} />
      </Animated.View>

      {showQuest ? (
        <Animated.View entering={enterFade(0)} style={styles.questWrap}>
          <FirstWorkoutsQuest progress={quest} />
        </Animated.View>
      ) : null}

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
              <StatTile
                title="Volume"
                value={formatCompact(displayWeight(data.weekVolumeKg, unitPref))}
                unit={unit}
                icon="barbell"
                color={colors.accent}
                deepColor={colors.accentDim}
                sheetTitle="Volume this week"
              >
                <VolumeDetail
                  byDay={data.weekVolumeByDay}
                  totalKg={data.weekVolumeKg}
                  sessionCount={data.weekSessions}
                  unitPref={unitPref}
                />
              </StatTile>
            </View>
            <View style={styles.tileCell}>
              <StatTile
                title="Sessions"
                value={data.weekSessions}
                icon="calendar"
                color={colors.blue}
                deepColor={colors.blueDeep}
                sheetTitle="Sessions this week"
              >
                <SessionsDetail sessions={data.weekSessionList} unitPref={unitPref} />
              </StatTile>
            </View>
          </Animated.View>
          <Animated.View entering={enterUp(2)} style={styles.tileWide}>
            <StatTile
              title="PRs"
              value={data.prCount}
              icon="trophy"
              color={colors.orange}
              deepColor={colors.orangeDeep}
              textColor={colors.onOrange}
              sheetTitle="Recent PRs"
            >
              <PrDetail prs={data.recentPrs} unitPref={unitPref} />
            </StatTile>
          </Animated.View>

          <Animated.View entering={enterUp(3)} style={styles.tipCard}>
            <AITipCard
              title="Coach tip"
              tip={tipState.status === 'done' ? tipState.text : null}
              loading={tipState.status === 'loading' || tipState.status === 'idle'}
              error={tipState.status === 'error'}
              onRefresh={refresh}
            />
          </Animated.View>

          <CheckInCard stagger={4} />
          <WeeklyCheckIn stagger={4} />

          <Animated.View entering={enterUp(5)}>
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
            <Animated.View entering={enterUp(6)}>
              <SectionLabel>Last session</SectionLabel>
              <Divider />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Last session: ${last.name}, ${posterDate(last.date)}. See details`}
                onPress={() => void openLastSession()}
                style={styles.lastRow}
              >
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {last.name}
                  </AppText>
                  <AppText variant="caption">{posterDate(last.date)}</AppText>
                </View>
                <AppText variant="caption" numberOfLines={1} style={styles.lastMeta}>
                  {formatCompact(displayWeight(last.volumeKg, unitPref))} {unit} · {last.sets} sets
                </AppText>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>
              <Divider />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="See all history"
                onPress={() => pushHistory()}
                style={styles.historyRow}
              >
                <AppText variant="bodyBold">See all history</AppText>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>
              <Divider />
            </Animated.View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
