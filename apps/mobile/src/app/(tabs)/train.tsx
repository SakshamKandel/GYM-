import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { GoalType, Plan, PlanWorkout } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { useRef, useState, type ComponentProps } from 'react';
import {
  AppText,
  Button,
  ConfirmDialog,
  Divider,
  enterDown,
  enterUp,
  FLOATING_TAB_SPACE,
  HeroCard,
  IconChip,
  PressableScale,
  Screen,
  SectionLabel,
  Sheet,
  Tag,
} from '../../components/ui';
import { WorkoutPreviewSheet } from '../../features/training/components/WorkoutPreviewSheet';
import { useTrainData } from '../../features/training/hooks';
import { estimateMinutesForExercises, estimateWorkoutMinutes } from '../../features/training/logic';
import { pushPath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';
import { useTemplates, type CustomTemplate } from '../../features/training/templates';
import { allExercises } from '../../lib/exercises';
import { getPlan, getPlanWorkouts, SEED_PLANS } from '../../lib/seed/plans';
import { useProfile } from '../../state/profile';

/** Train tab — next workout hero, plan rotation, saved templates, library, plan switcher. */

const FALLBACK_PLAN_ID = 'muscle-ppl';

const GOAL_ICONS: Record<GoalType, ComponentProps<typeof Ionicons>['name']> = {
  strength: 'barbell',
  muscle: 'fitness',
  fat_loss: 'flame',
};

const styles = StyleSheet.create({
  hero: { marginTop: spacing.lg },
  heroButton: { marginTop: spacing.sm },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 64,
  },
  /** IconChip-like rounded square holding the rotation's day number. */
  dayBlock: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
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
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  libraryText: { flex: 1 },
  planTiles: { gap: spacing.md, paddingRight: spacing.lg },
  planTile: {
    width: 220,
    borderRadius: radius.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 132,
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  /** Selection = accent border + CURRENT tag, not a heavy solid fill. */
  planTileSelected: { borderColor: colors.accent },
  planTileTitle: { fontFamily: type.bodySemiBold, fontSize: 18, color: colors.text },
  planTileBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  planTileMeta: { flexShrink: 1, minWidth: 0, textAlign: 'right' },
});

function PlanTile({ plan, selected, onPress }: { plan: Plan; selected: boolean; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${plan.name} plan, ${plan.daysPerWeek} days a week`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.planTile, selected && styles.planTileSelected]}
    >
      {selected ? <Tag label="Current" variant="filled" /> : null}
      <AppText style={styles.planTileTitle} tabular={false} numberOfLines={1}>
        {plan.name}
      </AppText>
      <View style={styles.planTileBottom}>
        <IconChip icon={GOAL_ICONS[plan.goalType]} size={40} />
        <AppText
          variant="caption"
          color={colors.textDim}
          tabular
          numberOfLines={1}
          style={styles.planTileMeta}
        >
          {`${plan.daysPerWeek} days/wk · ${plan.weeks} weeks`}
        </AppText>
      </View>
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

  const plan = getPlan(planId);
  const workouts = getPlanWorkouts(planId);
  const exerciseCount = allExercises().length;

  // Tap a rotation row to peek before committing; the sheet's "Start" navigates
  // once its exit finishes (so the modal never lingers over the pushed screen).
  const [preview, setPreview] = useState<PlanWorkout | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pendingStartId = useRef<string | null>(null);

  // Long-press a template row to delete it (with a branded confirm).
  const [deleteTarget, setDeleteTarget] = useState<CustomTemplate | null>(null);
  const startingTemplate = useRef(false);

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

  // Rows stagger after heading (0) + hero (1); cap so long lists don't crawl.
  const rowIdx = (i: number): number => Math.min(2 + i, 8);
  const tail = Math.min(2 + workouts.length, 8);

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterDown(0)}>
        <AppText variant="heading">Train</AppText>
      </Animated.View>

      {/* Hero: resume if a session is live, otherwise the next plan workout. */}
      <Animated.View entering={enterUp(0)}>
        <HeroCard style={styles.hero}>
          {activeWorkout ? (
            <>
              <Tag label="In progress" variant="filled" />
              <AppText variant="display" numberOfLines={1}>
                {activeWorkout.name.toUpperCase()}
              </AppText>
              <AppText variant="caption" color={colors.textDim}>
                Pick up where you left off
              </AppText>
              <Button
                label="Resume workout"
                onPress={() => pushPath('/workout')}
                style={styles.heroButton}
              />
            </>
          ) : nextWorkout ? (
            <>
              <Tag label="Up next" />
              <AppText variant="label" color={colors.textDim}>
                {plan?.name ?? 'your plan'}
              </AppText>
              <AppText variant="display" numberOfLines={1}>
                {nextWorkout.name}
              </AppText>
              <AppText variant="caption" color={colors.textDim} tabular>
                {`${nextWorkout.exercises.length} exercises · ~${estimateWorkoutMinutes(nextWorkout)} min`}
              </AppText>
              <Button
                label="Start workout"
                onPress={() => pushPath(`/workout/start?planWorkoutId=${nextWorkout.id}`)}
                style={styles.heroButton}
              />
            </>
          ) : (
            <AppText variant="body" color={colors.textDim}>
              {loaded ? 'Pick a plan below to get started.' : ' '}
            </AppText>
          )}
        </HeroCard>
      </Animated.View>

      {/* This plan's weekly rotation */}
      {workouts.length > 0 ? (
        <>
          <Animated.View entering={enterUp(1)}>
            <SectionLabel>This plan</SectionLabel>
          </Animated.View>
          {workouts.map((w, i) => {
            const isNext = !activeWorkout && nextWorkout?.id === w.id;
            return (
              <Animated.View key={w.id} entering={enterUp(rowIdx(i))}>
                {i > 0 ? <Divider /> : null}
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
        <Animated.View key={t.id} entering={enterUp(Math.min(tail + i, 8))}>
          {i > 0 ? <Divider /> : null}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${t.name} template, ${t.exercises.length} exercises. Tap to start, long press to delete.`}
            onPress={() => startTemplate(t)}
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
          onPress={() => pushPath('/workout/start')}
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

      {/* Plan switcher */}
      <Animated.View entering={enterUp(Math.min(tail + 3, 8))}>
        <SectionLabel>Plans</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.planTiles}>
          {SEED_PLANS.map((p) => (
            <PlanTile
              key={p.id}
              plan={p}
              selected={p.id === planId}
              onPress={() => update({ planId: p.id })}
            />
          ))}
        </ScrollView>
      </Animated.View>

      {/* Peek at a rotation workout before starting it. On "Start" the sheet
          closes first, then navigates — so the modal never sits over the logger. */}
      <Sheet
        visible={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          const id = pendingStartId.current;
          pendingStartId.current = null;
          if (id) pushPath(`/workout/start?planWorkoutId=${id}`);
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
