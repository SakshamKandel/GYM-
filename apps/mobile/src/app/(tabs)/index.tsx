import { memo, useCallback, useMemo } from 'react';
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
  Card,
  enterDown,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  IconChip,
  PhotoHero,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  Tag,
} from '../../components/ui';
import { homeHeroImage, homeHeroImageKey, photoForWorkout } from '../../components/visual';
import { getExercise } from '../../lib/exercises';
import { isMuscleGroup, type MuscleGroup } from '../../lib/muscleMap';
import { posterDate } from '../../lib/dates';
import { useAiTip } from '../../lib/ai/useAiTip';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { ProgressReportCard } from '../../components/home/ProgressReportCard';
import { WeightHomeCard } from '../../components/home/WeightHomeCard';
import { ActivitySection } from '../../features/activity/components/ActivitySection';
import { useWeights } from '../../features/body/hooks';
import {
  directionIcon,
  rateLabel,
  signedDelta,
  weightChartData,
  weightHeadline,
} from '../../features/body/logic';
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
import { pushPath as pushGymsPath } from '../../features/gyms/nav';
import { useMyCoach } from '../../features/mentorship/hooks';
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
/** CoachEntry card: 48dp avatar/chip + the Card's default inner padding. */
const COACH_CARD_HEIGHT = 48 + spacing.gutter * 2;

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
  questWrap: { marginBottom: spacing.md },
  // Coach entry row: Card supplies surface/radius/padding; this only
  // lays out the avatar + text + trailing affordance.
  coachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  coachAvatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  coachText: { flex: 1, gap: 2 },
  coachSkeleton: { marginBottom: spacing.md },
  /**
   * THE hero block (brief §11b) — the screen's one energetic center, now a
   * Train-style photographic hero (dark photo + scrim + red chip + red pill
   * CTA). Extra air around it per the brief's hero rhythm (28 = xl + xs).
   */
  heroWrap: { marginBottom: spacing.xl + spacing.xs },
  skelHero: { marginBottom: spacing.xl + spacing.xs },
  tileRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  tileCell: { flex: 1 },
  tileWide: { marginBottom: spacing.md },
  tipCard: { marginBottom: spacing.md },
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
  // Small cover-photo thumbnail (decorative) replacing the flat barbell glyph
  // on the last-session row — ties Home back to Train's photographic language.
  lastThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
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
  // Standalone teaser rows (gyms) sit between sections, outside any
  // gap-managed stack — they carry their own bottom rhythm so they never
  // fuse into the next card.
  teaserWrap: { marginBottom: spacing.md },
});

/** Outlined meta pill for the header row (dates, counts). Not a tap target. */
const MetaChip = memo(function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <AppText variant="label" color={colors.text}>
        {label}
      </AppText>
    </View>
  );
});

/**
 * The next-workout's muscle focus (first exercise's group), used to vary the
 * energetic hero photo. Mirrors Train's muscleFocusForWorkout without pulling
 * the anatomy viewer into the Home bundle; null falls back to the default photo.
 */
function nextWorkoutMuscle(workout: PlanWorkout | null): MuscleGroup | null {
  const first = workout?.exercises[0];
  if (!first) return null;
  const group = getExercise(first.exerciseId)?.muscleGroup;
  return group && isMuscleGroup(group) ? group : null;
}

/**
 * Hero block — the screen's single energetic center, now a Train-style
 * photographic hero (dark stock photo + scrim + red chip → Oswald title →
 * dim caption → one red pill CTA). Three states share the PhotoHero geometry:
 * done (celebratory), no-plan (inviting), and next-workout (energetic, photo
 * varied by muscle focus). The photo is decorative; chip/title/caption/CTA
 * carry the meaning.
 */
const Hero = memo(function Hero({
  planName,
  nextWorkout,
  doneToday,
  volume,
  unit,
  muscle,
}: {
  planName: string | null;
  nextWorkout: PlanWorkout | null;
  doneToday: DoneToday | null;
  /** Done-state volume, already converted to the display unit. */
  volume: number;
  unit: string;
  /** Next-workout muscle focus — drives the energetic photo. */
  muscle: MuscleGroup | null;
}) {
  if (doneToday !== null) {
    return (
      <PhotoHero
        source={homeHeroImage('done', null)}
        recyclingKey="home-hero-done"
        accessibilityLabel="An athlete mid-lift"
        chip={{ label: '✓ Done' }}
        title={doneToday.name}
        caption={`${formatCompact(volume)} ${unit} volume · ${planName ?? 'Workout'}`}
        cta={
          nextWorkout !== null
            ? {
                label: 'Go again',
                onPress: () =>
                  router.push(toHref(`/workout/start?planWorkoutId=${nextWorkout.id}`)),
              }
            : undefined
        }
      />
    );
  }

  if (nextWorkout === null) {
    return (
      <PhotoHero
        source={homeHeroImage('noPlan', null)}
        recyclingKey="home-hero-noplan"
        accessibilityLabel="A calm, empty gym"
        chip={{ label: 'Next workout' }}
        title="No plan yet"
        caption="Pick a plan to get your next workout here."
        cta={{ label: 'Choose a plan', onPress: () => router.push('/(tabs)/train') }}
      />
    );
  }

  return (
    <PhotoHero
      source={homeHeroImage('next', muscle, nextWorkout.name)}
      recyclingKey={`home-hero-${homeHeroImageKey('next', muscle, nextWorkout.name)}`}
      accessibilityLabel="Training photo"
      chip={{ label: 'Up next' }}
      title={nextWorkout.name}
      caption={`${planName !== null ? `${planName} · ` : ''}${nextWorkout.exercises.length} exercises`}
      cta={{
        label: 'Start workout',
        onPress: () => router.push(toHref(`/workout/start?planWorkoutId=${nextWorkout.id}`)),
      }}
    />
  );
});

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
 * Prominent Home entry into 1-on-1 coaching, data-driven via useMyCoach():
 * an ASSIGNED coach always wins (any tier) — enrolled badge + tap through to
 * the chat; a PENDING request shows "waiting" so the member doesn't see
 * "Find a coach" again after applying; otherwise Elite keeps the classic
 * Greece thread; everyone else (signed out included — useMyCoach returns
 * nulls) gets the coach directory — discovery, not a paywall.
 */
const CoachEntry = memo(function CoachEntry({ tier }: { tier: Tier }) {
  const { coach, request, loaded } = useMyCoach();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const elite = hasEntitlement({ tier }, 'coach_chat');

  // Signed in but getMyCoach hasn't resolved for this session (cold start,
  // offline) — coach/request are UNKNOWN, not absent. Hold a skeleton so an
  // enrolled member never sees "Find a coach" (or the wrong Greece thread)
  // while the fetch is in flight or failing. Signed-out users never fetch
  // (loaded stays false by design) and fall straight through to discovery.
  if (signedIn && !loaded) {
    return <Skeleton height={COACH_CARD_HEIGHT} radius={radius.block} style={styles.coachSkeleton} />;
  }

  if (coach !== null) {
    return (
      <Card
        accessibilityLabel={`Your coach, ${coach.displayName}. Enrolled. Open chat`}
        onPress={() => router.push(toHref('/coach-chat'))}
        style={styles.coachCard}
      >
        <Image
          source={coach.avatarUrl !== null ? { uri: coach.avatarUrl } : NEWIE}
          style={styles.coachAvatar}
          contentFit="cover"
          contentPosition="top"
          accessibilityElementsHidden
        />
        <View style={styles.coachText}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {coach.displayName}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {coach.headline.trim() !== '' ? coach.headline : 'Your 1-on-1 coach'}
          </AppText>
        </View>
        <Tag label="Enrolled" variant="dim" />
        <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
      </Card>
    );
  }

  if (request !== null) {
    return (
      <Card
        accessibilityLabel={`Coaching request sent to ${request.coachName}. Waiting for a reply. View coach profile`}
        onPress={() => router.push(toHref(`/coaches/${request.coachId}`))}
        style={styles.coachCard}
      >
        <IconChip icon="hourglass-outline" size={48} />
        <View style={styles.coachText}>
          <AppText variant="bodyBold" numberOfLines={1}>
            Request sent
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            Waiting on {request.coachName}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
      </Card>
    );
  }

  if (elite) {
    return (
      <Card
        accessibilityLabel="Chat with Greece, your one on one coach"
        onPress={() => router.push(toHref('/coach-chat'))}
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
        <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
      </Card>
    );
  }

  return (
    <Card
      accessibilityLabel="Find a coach. Browse coach profiles"
      onPress={() => router.push(toHref('/coaches'))}
      style={styles.coachCard}
    >
      <IconChip icon="people" size={48} />
      <View style={styles.coachText}>
        <AppText variant="bodyBold" numberOfLines={1}>
          Find a coach
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          Browse coach profiles
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
    </Card>
  );
});

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

  // Weight trend, straight from the offline store (features/body). Deriving
  // from an empty list while loading keeps hook order stable; the card shows
  // a skeleton until `weights` resolves. Headline = SMOOTHED trend (EWMA),
  // never the latest raw weigh-in.
  const weights = useWeights();
  const weightList = weights ?? [];
  // Trend smoothing (EWMA) + chart projection are pure but non-trivial over
  // ~90 rows; recompute only when the weight list or unit actually changes,
  // not on every one of Home's ~5 focus-driven re-renders.
  const { headline, weightDelta30, lastWeighIn } = useMemo(() => {
    const hl = weightHeadline(weightList, unitPref);
    const trendPoints = weightChartData(weightList, unitPref).trend;
    const firstTrend = trendPoints[0];
    const lastTrend = trendPoints[trendPoints.length - 1];
    const delta30 =
      firstTrend !== undefined && lastTrend !== undefined && trendPoints.length >= 2
        ? lastTrend.value - firstTrend.value
        : null;
    return {
      headline: hl,
      weightDelta30: delta30,
      lastWeighIn: weightList[weightList.length - 1],
    };
  }, [weights, unitPref]);

  const unit = unitLabel(unitPref);
  const latestPr = data?.recentPrs[0] ?? null;
  const latestPrText =
    latestPr !== null
      ? `${latestPr.exerciseName} · ${displayWeight(latestPr.weightKg, unitPref)} ${unit} × ${latestPr.reps}`
      : null;
  const last = data?.lastSession ?? null;
  // The hero's exact photo, mirroring the same state/muscle/name logic <Hero>
  // uses below — so the "last session" thumbnail can avoid repeating it.
  // Same input, same photo, computed here purely to de-collide two surfaces
  // that can be on screen together (e.g. "done" hero + last session row).
  // Hero photo selection scans the exercise catalog (getExercise) and builds a
  // recycling key; both are stable for a given home-data snapshot, so memoize
  // them rather than recomputing on every focus-driven re-render.
  const heroMuscle = useMemo(
    () => nextWorkoutMuscle(data?.nextWorkout ?? null),
    [data?.nextWorkout],
  );
  const heroPhotoKey = useMemo(
    () =>
      data === null
        ? null
        : data.doneToday !== null
          ? homeHeroImageKey('done', null)
          : data.nextWorkout === null
            ? homeHeroImageKey('noPlan', null)
            : homeHeroImageKey('next', heroMuscle, data.nextWorkout.name),
    [data, heroMuscle],
  );
  const showQuest = quest !== null && !quest.expired && !questDismissed;
  const todayDescription = data?.doneToday
    ? 'You showed up today. Keep the momentum going with one clear next step.'
    : data?.nextWorkout
      ? `${data.nextWorkout.name} is ready. Everything you need for today is below.`
      : 'Set your plan, then let this screen keep your next move obvious.';
  const sessionsThisWeek = data?.weekSessions ?? 0;

  // Stable nav handlers so the memoized report/weight cards don't re-render
  // just because Home re-rendered with fresh inline closures.
  const openProgress = useCallback(() => router.push('/(tabs)/progress'), []);
  const logWeight = useCallback(() => router.push(toHref('/body/log-weight')), []);

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
          <Animated.View entering={enterUp(0)} style={styles.heroWrap}>
            <Hero
              planName={data.planName}
              nextWorkout={data.nextWorkout}
              doneToday={data.doneToday}
              volume={displayWeight(data.doneToday?.volumeKg ?? 0, unitPref)}
              unit={unit}
              muscle={heroMuscle}
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

          <Animated.View entering={enterUp(4)}>
            <SectionLabel>Progress report</SectionLabel>
            <ProgressReportCard
              sessions={data.weekSessions}
              prCount={data.prCount}
              weightDeltaText={weightDelta30 !== null ? signedDelta(weightDelta30) : null}
              unit={unit}
              latestPrText={latestPrText}
              onOpen={openProgress}
            />
          </Animated.View>

          <Animated.View entering={enterUp(5)}>
            <SectionLabel>Body</SectionLabel>
            <WeightHomeCard
              loading={weights === null}
              trendValue={headline.trendValue}
              unit={unit}
              direction={directionIcon(headline.summary.direction)}
              rateText={rateLabel(headline.summary, unitPref)}
              lastLoggedText={
                lastWeighIn !== undefined ? `Last logged ${posterDate(lastWeighIn.date)}` : null
              }
              onOpen={openProgress}
              onLog={logWeight}
            />
          </Animated.View>

          {showQuest ? (
            <Animated.View entering={enterFade(0)} style={styles.questWrap}>
              <FirstWorkoutsQuest progress={quest} />
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(6)}>
            <SectionLabel>Coach</SectionLabel>
            <CoachEntry tier={serverTier} />
          </Animated.View>

          {/* Nearby gyms teaser (plan §6 P12, optional) — a single compact
              link row into the /gyms discovery hub; no thematic tie to any
              other Home section, so it gets its own quiet row rather than a
              full card. */}
          <Animated.View entering={enterUp(6)} style={styles.teaserWrap}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Find a gym near you"
              onPress={() => pushGymsPath('/gyms')}
              style={styles.historyRow}
            >
              <AppText variant="bodyBold">Nearby gyms</AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </PressableScale>
          </Animated.View>

          <CheckInCard stagger={7} />
          <WeeklyCheckIn stagger={7} />

          <Animated.View entering={enterUp(8)} style={styles.tipCard}>
            <AITipCard
              title="Coach tip"
              tip={tipState.status === 'done' ? tipState.text : null}
              loading={tipState.status === 'loading' || tipState.status === 'idle'}
              error={tipState.status === 'error'}
              onRefresh={refresh}
            />
          </Animated.View>

          {last !== null ? (
            <Animated.View entering={enterUp(9)}>
              <SectionLabel>Last session</SectionLabel>
              <View style={styles.rowStack}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Last session: ${last.name}, ${posterDate(last.date)}. See details`}
                  onPress={() => void openLastSession()}
                  style={styles.lastRow}
                >
                  <Image
                    source={photoForWorkout(last.name, null, heroPhotoKey)}
                    style={styles.lastThumb}
                    contentFit="cover"
                    transition={150}
                    recyclingKey={`last-${last.name}`}
                    accessibilityElementsHidden
                  />
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
