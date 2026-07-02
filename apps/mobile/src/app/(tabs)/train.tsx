import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { GoalType, Plan } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import type { ComponentProps } from 'react';
import {
  AppText,
  Button,
  Divider,
  enterDown,
  enterUp,
  FLOATING_TAB_SPACE,
  HeroCard,
  IconChip,
  PressableScale,
  Screen,
  SectionLabel,
  Tag,
} from '../../components/ui';
import { useTrainData } from '../../features/training/hooks';
import { estimateWorkoutMinutes } from '../../features/training/logic';
import { pushPath } from '../../features/training/nav';
import { allExercises } from '../../lib/exercises';
import { getPlan, getPlanWorkouts, SEED_PLANS } from '../../lib/seed/plans';
import { useProfile } from '../../state/profile';

/** Train tab — next workout hero, this plan's rotation, library, plan switcher. */

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
        <AppText variant="caption" color={colors.textDim} tabular>
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

  const plan = getPlan(planId);
  const workouts = getPlanWorkouts(planId);
  const exerciseCount = allExercises().length;

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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${w.name}, day ${w.day}, ${w.exercises.length} exercises. Start this workout.`}
                  onPress={() => pushPath(`/workout/start?planWorkoutId=${w.id}`)}
                  style={({ pressed }) => [styles.planRow, pressed && { opacity: 0.7 }]}
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
                </Pressable>
              </Animated.View>
            );
          })}
        </>
      ) : null}

      <Animated.View entering={enterUp(tail)}>
        <Button
          label="Quick start"
          variant="secondary"
          onPress={() => pushPath('/workout/start')}
          style={styles.quickStart}
          accessibilityLabel="Quick start an empty workout"
        />
      </Animated.View>

      {/* Exercise library */}
      <Animated.View entering={enterUp(tail + 1)}>
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
      <Animated.View entering={enterUp(tail + 2)}>
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
    </Screen>
  );
}
