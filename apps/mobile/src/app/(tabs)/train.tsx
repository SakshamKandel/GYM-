import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { GoalType, Plan, PlanWorkout } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { useRef, useState, type ComponentProps } from 'react';
import {
  AppText,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  enterDown,
  enterUp,
  FLOATING_TAB_SPACE,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  Skeleton,
  Tag,
} from '../../components/ui';
import { CoachWorkoutsSection } from '../../features/training/components/CoachWorkoutsSection';
import { WorkoutPreviewSheet } from '../../features/training/components/WorkoutPreviewSheet';
import { MuscleFocusSection, muscleFocusForWorkout } from '../../features/training/components/MuscleFocusSection';
import { useCoachWorkouts } from '../../features/training/coachWorkouts';
import { useTrainData } from '../../features/training/hooks';
import { estimateMinutesForExercises, estimateWorkoutMinutes } from '../../features/training/logic';
import { pushPath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';
import { useTemplates, type CustomTemplate } from '../../features/training/templates';
import type { CoachWorkoutRow } from '../../lib/api/client';
import { allExercises } from '../../lib/exercises';
import { getPlan, getPlanWorkouts, SEED_PLANS } from '../../lib/seed/plans';
import { useProfile } from '../../state/profile';

/** Train tab — red hero block (next/active workout), plan rotation, saved templates, library, plan switcher. */

const FALLBACK_PLAN_ID = 'muscle-ppl';

const GOAL_ICONS: Record<GoalType, ComponentProps<typeof Ionicons>['name']> = {
  strength: 'barbell',
  muscle: 'fitness',
  fat_loss: 'flame',
};

/** Loading-skeleton height standing in for the red hero block. */
const HERO_HEIGHT = 180;

const styles = StyleSheet.create({
  /** Extra air around the hero block (brief §3: up to 28 around the hero). */
  hero: { marginTop: spacing.xl },
  heroContent: { gap: spacing.sm },
  heroTitle: { textTransform: 'uppercase' },
  /** Secondary line on the red block: onBlock ink, dimmed — never white-on-red. */
  heroMeta: { opacity: 0.8 },
  heroButton: { marginTop: spacing.sm },
  /** Outlined meta pill for the header chips row (brief §6 — chips MAY have borders). */
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Round icon button beside the huge title (library shortcut). */
  headerAction: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: { marginTop: spacing.md },
  /** Charcoal block row (brief §11c) — rounded fill replaces Divider hairlines. */
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  /** Gap between sibling rows in a stack — replaces the old Divider. */
  rowGap: { marginTop: spacing.sm },
  /** IconChip-like rounded square holding the rotation's day number. */
  dayBlock: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { fontFamily: type.display, fontSize: 20, color: colors.text },
  planRowText: { flex: 1 },
  quickStart: { marginTop: spacing.lg },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
    marginTop: spacing.xl,
  },
  libraryText: { flex: 1 },
  planPills: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.lg },
  /** Plan switcher as outlined pills; selected = solid red fill, BLACK label. */
  planPill: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.gutter,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planPillSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  planPillLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  planMeta: { marginTop: spacing.md },
});

/** Non-interactive outlined meta chip under the screen title (brief §5/§6). */
function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <AppText variant="label" color={colors.text} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function PlanPill({ plan, selected, onPress }: { plan: Plan; selected: boolean; onPress: () => void }) {
  const ink = selected ? colors.onBlock : colors.textDim;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${plan.name} plan, ${plan.daysPerWeek} days a week`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.planPill, selected && styles.planPillSelected]}
    >
      <Ionicons name={GOAL_ICONS[plan.goalType]} size={16} color={ink} />
      <AppText style={styles.planPillLabel} color={ink} tabular={false} numberOfLines={1}>
        {plan.name}
      </AppText>
    </PressableScale>
  );
}

export default function TrainScreen() {
  const storedPlanId = useProfile((s) => s.planId);
  // Fall back on null OR an id we don't know (older/foreign onboarding data).
  const planId = storedPlanId && getPlan(storedPlanId) ? storedPlanId : FALLBACK_PLAN_ID;
  const update = useProfile((s) => s.update);
  const { nextWorkout, activeWorkout, loaded } = useTrainData(planId);
  const templates = useTemplates((s) => s.templates);
  const coachWorkoutsSection = useCoachWorkouts();

  const plan = getPlan(planId);
  const workouts = getPlanWorkouts(planId);
  const exerciseCount = allExercises().length;
  const initialMuscleFocus = muscleFocusForWorkout(nextWorkout);
  const trainStatus = activeWorkout ? 'ACTIVE' : nextWorkout ? `DAY ${nextWorkout.day}` : 'FREESTYLE';
  const trainDescription = activeWorkout
    ? 'Your workout is open. Pick up exactly where you left off.'
    : nextWorkout
      ? `${nextWorkout.exercises.length} movements are ready when you are.`
      : 'Choose a plan or build a workout around the muscles you want to train.';

  // Tap a rotation row to peek before committing; the sheet's "Start" navigates
  // once its exit finishes (so the modal never lingers over the pushed screen).
  const [preview, setPreview] = useState<PlanWorkout | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pendingStartId = useRef<string | null>(null);

  // Long-press a template row to delete it (with a branded confirm).
  const [deleteTarget, setDeleteTarget] = useState<CustomTemplate | null>(null);
  const startingTemplate = useRef(false);

  // Starting anything while another session is open would silently resume the
  // OLD workout (session.start resumes; the tap would no-op with no feedback).
  // Ask first: discard the open one, or keep it. `pendingAction` holds what
  // the user tried to start until they decide.
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const guardStart = (run: () => void): void => {
    if (activeWorkout) setPendingAction(() => run);
    else run();
  };

  const startTemplate = (t: CustomTemplate): void => {
    if (startingTemplate.current) return;
    startingTemplate.current = true;
    void (async () => {
      try {
        await useSession.getState().startFromTemplate(t);
        pushPath('/workout');
      } finally {
        startingTemplate.current = false;
      }
    })();
  };

  const startingCoachWorkout = useRef(false);
  const startCoachWorkout = (w: CoachWorkoutRow): void => {
    if (startingCoachWorkout.current) return;
    startingCoachWorkout.current = true;
    void (async () => {
      try {
        await useSession.getState().startFromCoachPlan(w);
        pushPath('/workout');
      } finally {
        startingCoachWorkout.current = false;
      }
    })();
  };

  // Rows stagger after heading (0) + hero (1); cap so long lists don't crawl.
  const rowIdx = (i: number): number => Math.min(2 + i, 8);
  const tail = Math.min(2 + workouts.length, 8);

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      {/* Brief §5 header: eyebrow → huge Oswald title → meta chips. The library
          shortcut lives in the action slot (same target as before). */}
      <ScreenHeader
        eyebrow={plan?.name ?? 'Your training'}
        title="Train"
        action={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Open exercise library"
            onPress={() => pushPath('/exercises')}
            style={styles.headerAction}
          >
            <Ionicons name="search" size={20} color={colors.text} />
          </PressableScale>
        }
        meta={
          <>
            <MetaChip label={trainStatus} />
            {workouts.length > 0 ? <MetaChip label={`${workouts.length}-day rotation`} /> : null}
          </>
        }
      />
      <Animated.View entering={enterDown(1)}>
        <AppText variant="body" color={colors.textDim} style={styles.description}>
          {trainDescription}
        </AppText>
      </Animated.View>

      {/* Hero: THE one red block on this screen — resume if a session is live,
          otherwise the next plan workout. Black ink + black pill CTA on red. */}
      <Animated.View entering={enterUp(0)}>
        {activeWorkout || nextWorkout ? (
          <Card variant="red" style={styles.hero}>
            <View style={styles.heroContent}>
              {activeWorkout ? (
                <>
                  <Tag label="In progress" variant="onBlock" />
                  <AppText
                    variant="display"
                    color={colors.onBlock}
                    style={styles.heroTitle}
                    numberOfLines={1}
                  >
                    {activeWorkout.name.toUpperCase()}
                  </AppText>
                  <AppText variant="caption" color={colors.onBlock} style={styles.heroMeta}>
                    Pick up where you left off
                  </AppText>
                  <Button
                    label="Resume workout"
                    variant="onBlock"
                    onPress={() => pushPath('/workout')}
                    style={styles.heroButton}
                  />
                </>
              ) : nextWorkout ? (
                <>
                  <Tag label="Up next" variant="onBlock" />
                  <AppText
                    variant="display"
                    color={colors.onBlock}
                    style={styles.heroTitle}
                    numberOfLines={1}
                  >
                    {nextWorkout.name}
                  </AppText>
                  <AppText
                    variant="caption"
                    color={colors.onBlock}
                    tabular
                    numberOfLines={1}
                    style={styles.heroMeta}
                  >
                    {`${plan?.name ?? 'Your plan'} · ${nextWorkout.exercises.length} exercises · ~${estimateWorkoutMinutes(nextWorkout)} min`}
                  </AppText>
                  <Button
                    label="Start workout"
                    variant="onBlock"
                    onPress={() => pushPath(`/workout/start?planWorkoutId=${nextWorkout.id}`)}
                    style={styles.heroButton}
                  />
                </>
              ) : null}
            </View>
          </Card>
        ) : loaded ? (
          <EmptyState
            icon="barbell-outline"
            title="No plan selected"
            body="Pick a plan below to get started."
            style={styles.hero}
          />
        ) : (
          <Skeleton height={HERO_HEIGHT} radius={radius.block} style={styles.hero} />
        )}
      </Animated.View>

      {/* Native, touchable anatomy map. The selected muscle immediately filters
          the bundled offline exercise library below it. */}
      <Animated.View entering={enterUp(1)}>
        <MuscleFocusSection key={initialMuscleFocus} initialMuscle={initialMuscleFocus} />
      </Animated.View>

      {/* This plan's weekly rotation — charcoal block rows, gaps instead of hairlines */}
      {workouts.length > 0 ? (
        <>
          <Animated.View entering={enterUp(2)}>
            <SectionLabel>This plan</SectionLabel>
          </Animated.View>
          {workouts.map((w, i) => {
            const isNext = !activeWorkout && nextWorkout?.id === w.id;
            return (
              <Animated.View
                key={w.id}
                entering={enterUp(rowIdx(i))}
                style={i > 0 ? styles.rowGap : undefined}
              >
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`${w.name}, day ${w.day}, ${w.exercises.length} exercises. Preview this workout.`}
                  onPress={() => {
                    setPreview(w);
                    setPreviewOpen(true);
                  }}
                  pressScale={0.985}
                  style={styles.planRow}
                >
                  <View style={styles.dayBlock}>
                    <AppText style={styles.dayNum} tabular>
                      {w.day}
                    </AppText>
                  </View>
                  <View style={styles.planRowText}>
                    <AppText variant="bodyBold" numberOfLines={1}>
                      {w.name}
                    </AppText>
                    <AppText variant="caption" color={colors.textDim}>
                      {`${w.exercises.length} exercises`}
                    </AppText>
                  </View>
                  {isNext ? <Tag label="Up next" /> : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                </PressableScale>
              </Animated.View>
            );
          })}
        </>
      ) : null}

      {/* Saved custom templates — tap to start, long-press to delete. */}
      <Animated.View entering={enterUp(tail)}>
        <SectionLabel>Your templates</SectionLabel>
        {templates.length === 0 ? (
          <AppText variant="caption" color={colors.textFaint}>
            Finish a workout to save it as a template.
          </AppText>
        ) : null}
      </Animated.View>
      {templates.map((t, i) => (
        <Animated.View
          key={t.id}
          entering={enterUp(Math.min(tail + i, 8))}
          style={i > 0 ? styles.rowGap : undefined}
        >
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${t.name} template, ${t.exercises.length} exercises. Tap to start, long press to delete.`}
            onPress={() => guardStart(() => startTemplate(t))}
            onLongPress={() => setDeleteTarget(t)}
            pressScale={0.985}
            style={styles.planRow}
          >
            <IconChip icon="bookmark" />
            <View style={styles.planRowText}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {t.name}
              </AppText>
              <AppText variant="caption" color={colors.textDim} tabular>
                {`${t.exercises.length} exercises · ~${estimateMinutesForExercises(t.exercises)} min`}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </PressableScale>
        </Animated.View>
      ))}

      <Animated.View entering={enterUp(Math.min(tail + 1, 8))}>
        <Button
          label="Quick start"
          variant="secondary"
          onPress={() => guardStart(() => pushPath('/workout/start'))}
          style={styles.quickStart}
          accessibilityLabel="Quick start an empty workout"
        />
      </Animated.View>

      {/* Exercise library */}
      <Animated.View entering={enterUp(Math.min(tail + 2, 8))}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Exercise library, ${exerciseCount} exercises`}
          onPress={() => pushPath('/exercises')}
          style={styles.libraryRow}
        >
          <IconChip icon="search" />
          <View style={styles.libraryText}>
            <AppText variant="bodyBold">Exercise library</AppText>
            <AppText variant="caption" color={colors.textDim} tabular>
              {`${exerciseCount} exercises`}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </PressableScale>
      </Animated.View>

      {/* Coach-assigned workouts (SCALE-UP-PLAN §4.3) — sits above the plan
          switcher; hidden entirely when there's nothing to show yet. */}
      <Animated.View entering={enterUp(Math.min(tail + 3, 8))}>
        <CoachWorkoutsSection section={coachWorkoutsSection} onStart={startCoachWorkout} />
      </Animated.View>

      {/* Plan switcher — pill chips; selected = red fill (chips may be red,
          the one-red-BLOCK law is about cards). */}
      <Animated.View entering={enterUp(Math.min(tail + 4, 8))}>
        <SectionLabel>Plans</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.planPills}>
          {SEED_PLANS.map((p) => (
            <PlanPill
              key={p.id}
              plan={p}
              selected={p.id === planId}
              onPress={() => update({ planId: p.id })}
            />
          ))}
        </ScrollView>
        {plan ? (
          <AppText variant="caption" color={colors.textDim} tabular style={styles.planMeta}>
            {`${plan.name} · ${plan.daysPerWeek} days/wk · ${plan.weeks} weeks`}
          </AppText>
        ) : null}
      </Animated.View>

      {/* Peek at a rotation workout before starting it. On "Start" the sheet
          closes first, then navigates — so the modal never sits over the logger. */}
      <Sheet
        visible={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          const id = pendingStartId.current;
          pendingStartId.current = null;
          if (id) guardStart(() => pushPath(`/workout/start?planWorkoutId=${id}`));
        }}
        title={preview?.name}
      >
        {preview ? (
          <WorkoutPreviewSheet
            workout={preview}
            onStart={() => {
              pendingStartId.current = preview.id;
              setPreviewOpen(false);
            }}
          />
        ) : null}
      </Sheet>

      {/* Another workout is open — starting a new one would silently resume
          the old session. Make the trade explicit. */}
      <ConfirmDialog
        visible={pendingAction !== null}
        title="Workout in progress"
        message={
          activeWorkout
            ? `"${activeWorkout.name}" is still open. Starting a new workout discards it — sets you logged stay in history only after you finish a workout.`
            : undefined
        }
        confirmLabel="Discard & start new"
        cancelLabel="Keep current"
        danger
        onConfirm={() => {
          const run = pendingAction;
          setPendingAction(null);
          void (async () => {
            await useSession.getState().discard();
            run?.();
          })();
        }}
        onCancel={() => setPendingAction(null)}
      />

      {/* Template delete confirm — long-press is destructive, so ask first. */}
      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete template?"
        message={
          deleteTarget
            ? `"${deleteTarget.name}" will be removed. Your logged workouts stay.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        danger
        onConfirm={() => {
          if (deleteTarget) useTemplates.getState().deleteTemplate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Screen>
  );
}
