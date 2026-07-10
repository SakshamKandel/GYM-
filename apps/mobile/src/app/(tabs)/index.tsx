import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { displayWeight, hasEntitlement, unitLabel, type PlanWorkout, type Tier } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AITipCard,
  AnimatedTierRing,
  AppText,
  Button,
  Card,
  enterDown,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  Tag,
} from '../../components/ui';
import { posterDate } from '../../lib/dates';
import { useAiTip } from '../../lib/ai/useAiTip';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { ActivitySection } from '../../features/activity/components/ActivitySection';
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

/**
 * Skeleton stand-in for the red hero block (eyebrow + display title + caption
 * + 56dp pill CTA inside gutter padding ≈ 212dp). The real block is
 * content-sized so font scaling never clips it.
 */
const SKELETON_HERO_H = 212;
/** Matches the bento/stat tile minHeight so skeletons don't jump. */
const TILE_HEIGHT = 148;

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
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Outlined meta pill (brief §6): chips may carry strokes — cards may not.
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: { marginTop: spacing.md, marginBottom: spacing.xl },
  questWrap: { marginBottom: spacing.lg },
  // Coach entry row: Card supplies surface/radius/padding; this only
  // lays out the avatar + text + trailing affordance.
  coachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
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
  /**
   * THE red hero block (brief §11b) — the screen's one energetic center.
   * Flat blockRed fill, chunky corners, black ink, black pill CTA. Extra air
   * around it per the brief's hero rhythm (28 = xl + xs).
   */
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginBottom: spacing.xl + spacing.xs,
  },
  /** Secondary ink on red: black at 0.75 ≈ 5.2:1 on blockRed — reads, quietly. */
  heroDim: { opacity: 0.75 },
  skelHero: { marginBottom: spacing.xl + spacing.xs },
  tileRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  tileCell: { flex: 1 },
  tileWide: { marginBottom: spacing.lg },
  tipCard: { marginBottom: spacing.lg },
  // Last-session zone: gap-separated rounded charcoal rows replace Divider
  // hairlines (brief §11c).
  rowStack: { gap: spacing.sm },
  lastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  lastMain: { flex: 1, gap: 2 },
  // Right-aligned meta must not be pushed off-screen by a long session name.
  lastMeta: { flexShrink: 0, textAlign: 'right' },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
});

/** Outlined meta pill for the header row (dates, counts). Not a tap target. */
function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <AppText variant="label" color={colors.text}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * Red hero block — the screen's single red block AND its single primary CTA
 * (a black "onBlock" pill, per the one-CTA law). Three states share one
 * geometry: eyebrow/tag → Oswald display name → caption → full-width pill.
 * All ink is black on red; secondary lines drop to 0.75 opacity.
 */
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
      <View
        accessibilityLabel={`Workout done today: ${doneToday.name}. ${formatCompact(volume)} ${unit} volume`}
        style={styles.hero}
      >
        <Tag label="✓ Done" variant="onBlock" />
        <AppText
          variant="display"
          color={colors.onBlock}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {doneToday.name}
        </AppText>
        <AppText variant="caption" color={colors.onBlock} numberOfLines={1} style={styles.heroDim}>
          {formatCompact(volume)} {unit} volume · {planName ?? 'Workout'}
        </AppText>
        {nextWorkout !== null ? (
          <Button
            label="Go again"
            variant="onBlock"
            onPress={() => router.push(toHref(`/workout/start?planWorkoutId=${nextWorkout.id}`))}
          />
        ) : null}
      </View>
    );
  }

  if (nextWorkout === null) {
    return (
      <View
        accessibilityLabel="No plan yet. Choose a plan to get your next workout here."
        style={styles.hero}
      >
        <AppText variant="label" color={colors.onBlock}>
          Next workout
        </AppText>
        <AppText
          variant="display"
          color={colors.onBlock}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          No plan yet
        </AppText>
        <AppText variant="caption" color={colors.onBlock} numberOfLines={1} style={styles.heroDim}>
          Pick a plan to get your next workout here.
        </AppText>
        <Button
          label="Choose a plan"
          variant="onBlock"
          onPress={() => router.push('/(tabs)/train')}
        />
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`Next workout: ${nextWorkout.name}, ${nextWorkout.exercises.length} exercises`}
      style={styles.hero}
    >
      <AppText variant="label" color={colors.onBlock}>
        Next workout
      </AppText>
      <AppText
        variant="display"
        color={colors.onBlock}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {nextWorkout.name}
      </AppText>
      <AppText variant="caption" color={colors.onBlock} numberOfLines={1} style={styles.heroDim}>
        {planName !== null ? `${planName} · ` : ''}
        {nextWorkout.exercises.length} exercises
      </AppText>
      <Button
        label="Start workout"
        variant="onBlock"
        onPress={() => router.push(toHref(`/workout/start?planWorkoutId=${nextWorkout.id}`))}
      />
    </View>
  );
}

/**
 * Skeleton geometry for everything data-driven: the red hero block, the
 * two-tile stat row, and the wide PR tile — all at `radius.block` to match
 * the new geometry. Static fade-in per design law — no shimmer.
 */
function HomeSkeleton() {
  return (
    <View>
      <Skeleton height={SKELETON_HERO_H} radius={radius.block} style={styles.skelHero} />
      <View style={styles.tileRow}>
        <Skeleton height={TILE_HEIGHT} radius={radius.block} style={styles.tileCell} />
        <Skeleton height={TILE_HEIGHT} radius={radius.block} style={styles.tileCell} />
      </View>
      <Skeleton height={TILE_HEIGHT} radius={radius.block} />
    </View>
  );
}

/**
 * Prominent Home entry into the 1-on-1 coach chat. Elite unlocks the thread and
 * taps through to /coach-chat; lower tiers see an Elite lock and route to plans.
 */
function CoachEntry({ tier }: { tier: Tier }) {
  const unlocked = hasEntitlement({ tier }, 'coach_chat');
  return (
    <Card
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
    </Card>
  );
}

export default function HomeScreen() {
  const displayName = useProfile((s) => s.displayName);
  const planId = useProfile((s) => s.planId);
  const unitPref = useProfile((s) => s.unitPref);
  const goalType = useProfile((s) => s.goalType);
  const startWeightKg = useProfile((s) => s.startWeightKg);
  const targetWeightKg = useProfile((s) => s.targetWeightKg);
  // Server-authoritative tier for the greeting ring and coach-chat gate —
  // never useProfile.tier (local upgrade-only mirror, known to drift above
  // the server's value, which would route downgraded users into a dead-end).
  const serverTier = useAuth((s) => s.user?.tier ?? 'starter');
  const data = useHomeData(planId);
  const weeklyStreak = useWeeklyStreak();
  const quest = useQuestProgress();
  const questDismissed = useQuest((s) => s.dismissed);

  const unit = unitLabel(unitPref);
  const last = data?.lastSession ?? null;
  const showQuest = quest !== null && !quest.expired && !questDismissed;
  const todayDescription = data?.doneToday
    ? 'You showed up today. Keep the momentum going with one clear next step.'
    : data?.nextWorkout
      ? `${data.nextWorkout.name} is ready. Everything you need for today is below.`
      : 'Set your plan, then let this screen keep your next move obvious.';
  const sessionsThisWeek = data?.weekSessions ?? 0;

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

      {/* Header pattern (brief §5): eyebrow → huge Oswald TODAY → meta chips.
          The old CommandHeader content survives: badge → eyebrow, poster date
          + sessions status → chips, description → the dim line below. */}
      <ScreenHeader
        eyebrow={data?.doneToday ? 'Done' : 'Focus'}
        title="Today"
        meta={
          <>
            <MetaChip label={posterDate()} />
            <MetaChip
              label={`${sessionsThisWeek} ${sessionsThisWeek === 1 ? 'session' : 'sessions'} this week`}
            />
          </>
        }
      />
      <Animated.View entering={enterDown(1)}>
        <AppText variant="body" color={colors.textDim} style={styles.headingCopy}>
          {todayDescription}
        </AppText>
      </Animated.View>

      {data === null ? (
        <HomeSkeleton />
      ) : (
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

          {/* Bento zone: cream steps block + charcoal calories block. */}
          <ActivitySection stagger={1} />

          <Animated.View entering={enterUp(2)}>
            <SectionLabel>This week</SectionLabel>
            <View style={styles.tileRow}>
              <View style={styles.tileCell}>
                <StatTile
                  title="Volume"
                  value={formatCompact(displayWeight(data.weekVolumeKg, unitPref))}
                  unit={unit}
                  icon="barbell"
                  color={colors.surface}
                  deepColor={colors.surfaceRaised}
                  textColor={colors.text}
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
                  color={colors.surface}
                  deepColor={colors.surfaceRaised}
                  textColor={colors.text}
                  sheetTitle="Sessions this week"
                >
                  <SessionsDetail sessions={data.weekSessionList} unitPref={unitPref} />
                </StatTile>
              </View>
            </View>
          </Animated.View>
          <Animated.View entering={enterUp(3)} style={styles.tileWide}>
            <StatTile
              title="PRs"
              value={data.prCount}
              icon="trophy"
              color={colors.surface}
              deepColor={colors.surfaceRaised}
              textColor={colors.text}
              sheetTitle="Recent PRs"
            >
              <PrDetail prs={data.recentPrs} unitPref={unitPref} />
            </StatTile>
          </Animated.View>

          {showQuest ? (
            <Animated.View entering={enterFade(0)} style={styles.questWrap}>
              <FirstWorkoutsQuest progress={quest} />
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(4)}>
            <SectionLabel>Coach</SectionLabel>
            <CoachEntry tier={serverTier} />
          </Animated.View>

          <CheckInCard stagger={5} />
          <WeeklyCheckIn stagger={5} />

          <Animated.View entering={enterUp(6)} style={styles.tipCard}>
            <AITipCard
              title="Coach tip"
              tip={tipState.status === 'done' ? tipState.text : null}
              loading={tipState.status === 'loading' || tipState.status === 'idle'}
              error={tipState.status === 'error'}
              onRefresh={refresh}
            />
          </Animated.View>

          {last !== null ? (
            <Animated.View entering={enterUp(7)}>
              <SectionLabel>Last session</SectionLabel>
              <View style={styles.rowStack}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Last session: ${last.name}, ${posterDate(last.date)}. See details`}
                  onPress={() => void openLastSession()}
                  style={styles.lastRow}
                >
                  <IconChip icon="barbell-outline" />
                  <View style={styles.lastMain}>
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
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="See all history"
                  onPress={() => pushHistory()}
                  style={styles.historyRow}
                >
                  <AppText variant="bodyBold">See all history</AppText>
                  <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                </PressableScale>
              </View>
            </Animated.View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
