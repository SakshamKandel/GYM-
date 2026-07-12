import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Meal } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  Skeleton,
  UpgradePrompt,
} from '../components/ui';
import { useCoachDiet } from '../features/nutrition/coachDiet';
import type { CoachDietItem, CoachDietMeal, CoachDietPlanRow } from '../lib/api/client';

/**
 * /coach-diet — read-only view of the signed-in member's active coach-
 * assigned diet plans (SCALE-UP-PLAN §4.3). Reached from the Food tab's
 * "Coach diet plan" card. Owns the full gate itself (locked / no-coach /
 * plans), mirroring /coach-chat's screen-level gate pattern; reloads on
 * focus via useCoachDiet.
 */

const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

const MEAL_ICON: Record<Meal, ComponentProps<typeof Ionicons>['name']> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snacks: 'cafe-outline',
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  gateWrap: { gap: spacing.lg, paddingTop: spacing.xl },
  loadingWrap: { gap: spacing.md, paddingTop: spacing.xl },
  emptyCaption: { paddingTop: spacing.xl },
  planCard: { gap: spacing.lg, marginTop: spacing.lg },
  planNotes: { marginTop: -spacing.sm },
  mealHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mealItems: { gap: spacing.sm },
  itemRow: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
  },
  itemTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  itemName: { flex: 1 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  macroChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
});

function Header({ caption }: { caption?: string }) {
  return (
    <Animated.View entering={enterDown()} style={styles.header}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={4}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </PressableScale>
      <View style={styles.headerText}>
        <AppText variant="title">Coach diet plan</AppText>
        {caption ? <AppText variant="caption">{caption}</AppText> : null}
      </View>
    </Animated.View>
  );
}

/** Non-interactive outlined pill for one macro value (kcal/protein/carbs/fat). */
function MacroChip({ label }: { label: string }) {
  return (
    <View style={styles.macroChip}>
      <AppText variant="caption" color={colors.textDim} tabular>
        {label}
      </AppText>
    </View>
  );
}

function macroChips(item: CoachDietItem): string[] {
  const chips: string[] = [];
  if (item.kcal !== undefined) chips.push(`${item.kcal} kcal`);
  if (item.protein !== undefined) chips.push(`P ${item.protein}`);
  if (item.carbs !== undefined) chips.push(`C ${item.carbs}`);
  if (item.fat !== undefined) chips.push(`F ${item.fat}`);
  return chips;
}

function DietItemRow({ item }: { item: CoachDietItem }) {
  const chips = macroChips(item);
  return (
    <View style={styles.itemRow}>
      <View style={styles.itemTop}>
        <AppText variant="body" style={styles.itemName} numberOfLines={2}>
          {item.name}
        </AppText>
        <AppText variant="caption" color={colors.textDim} tabular numberOfLines={1}>
          {item.qty}
        </AppText>
      </View>
      {chips.length > 0 ? (
        <View style={styles.chipsRow}>
          {chips.map((c) => (
            <MacroChip key={c} label={c} />
          ))}
        </View>
      ) : null}
      {item.note ? (
        <AppText variant="caption" color={colors.textDim}>
          {item.note}
        </AppText>
      ) : null}
    </View>
  );
}

function DietMealSection({ meal }: { meal: CoachDietMeal }) {
  if (meal.items.length === 0) return null;
  return (
    <View>
      <View style={styles.mealHeader}>
        <Ionicons name={MEAL_ICON[meal.meal]} size={18} color={colors.textDim} />
        <AppText variant="bodyBold">{MEAL_LABEL[meal.meal]}</AppText>
      </View>
      <View style={styles.mealItems}>
        {meal.items.map((item, i) => (
          <DietItemRow key={`${meal.meal}-${i}`} item={item} />
        ))}
      </View>
    </View>
  );
}

function DietPlanCard({ plan, coachName }: { plan: CoachDietPlanRow; coachName: string }) {
  return (
    <Card style={styles.planCard}>
      <View>
        <AppText variant="title" numberOfLines={2}>
          {plan.title}
        </AppText>
        <AppText variant="caption" color={colors.textDim}>
          {`From ${coachName}`}
        </AppText>
      </View>
      {plan.notes ? (
        <AppText variant="body" color={colors.textDim} style={styles.planNotes}>
          {plan.notes}
        </AppText>
      ) : null}
      {plan.meals.map((meal, i) => (
        <DietMealSection key={`${meal.meal}-${i}`} meal={meal} />
      ))}
    </Card>
  );
}

export default function CoachDietScreen() {
  const section = useCoachDiet();

  if (section.kind === 'hidden') {
    return (
      <Screen scroll>
        <Header />
        <View style={styles.loadingWrap}>
          <Skeleton height={120} radius={radius.block} />
          <Skeleton height={120} radius={radius.block} />
        </View>
      </Screen>
    );
  }

  if (section.kind === 'error') {
    return (
      <Screen scroll>
        <Header />
        <View style={styles.gateWrap}>
          <AppText variant="body" color={colors.textDim}>
            Couldn&apos;t load your coach&apos;s diet plan. Check your connection and try again.
          </AppText>
          <Button label="Retry" variant="secondary" onPress={section.retry} />
        </View>
      </Screen>
    );
  }

  if (section.kind === 'locked') {
    return (
      <Screen scroll>
        <Header />
        <View style={styles.gateWrap}>
          <UpgradePrompt
            requiredTier={section.requiredTier}
            title="Coach diet plans"
            description="Get a personalized meal plan built and assigned by your coach."
          />
          <Button
            label="Browse coaches"
            variant="secondary"
            onPress={() => router.push('/coaches' as Href)}
          />
        </View>
      </Screen>
    );
  }

  if (section.kind === 'no-coach') {
    return (
      <Screen scroll>
        <Header caption="Get a coach for a custom diet plan" />
        <View style={styles.gateWrap}>
          <AppText variant="body" color={colors.textDim}>
            A coach can build you a diet plan matched to your goals and assign it right here.
          </AppText>
          <Button label="Browse coaches" onPress={() => router.push('/coaches' as Href)} />
        </View>
      </Screen>
    );
  }

  const { plans, coach } = section;

  return (
    <Screen scroll>
      <Header caption={`From ${coach.displayName}`} />
      {plans.length === 0 ? (
        <Animated.View entering={enterUp(0)}>
          <AppText variant="caption" color={colors.textFaint} style={styles.emptyCaption}>
            {`${coach.displayName} hasn't assigned you a diet plan yet.`}
          </AppText>
        </Animated.View>
      ) : (
        plans.map((plan, i) => (
          <Animated.View key={plan.id} entering={enterUp(i)}>
            <DietPlanCard plan={plan} coachName={coach.displayName} />
          </Animated.View>
        ))
      )}
    </Screen>
  );
}
