import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  Button,
  Card,
  Divider,
  enterFade,
  enterUp,
  Ring,
  SectionLabel,
  Sheet,
  Skeleton,
  Stepper,
} from '../../../components/ui';
import { dayLabel, todayIso } from '../../../lib/dates';
import { useProfile } from '../../../state/profile';
import { useActivityToday, useStepsWeek, type ActivityToday, type DaySteps } from '../hooks';
import { requestStepPermission } from '../pedometer';

/**
 * Home "Activity" section: a STEPS tile and a CALORIES (net energy) tile,
 * each opening a detail Sheet. All math comes pre-cooked from useActivityToday;
 * this file is presentation only.
 */

// Feature isolation: the Food tab href literal is copied from
// features/nutrition/nav.ts (FOOD_TAB_HREF) — do NOT import across features.
const FOOD_TAB_HREF = '/(tabs)/food' as Href;

/** Tallest bar in the 7-day chart. */
const BAR_TRACK = 56;
/** Both tiles hold this height so the pair reads as one unit. */
const TILE_MIN_H = 148;

/** Sanctioned rgba (brief §2): progress-bar/ring track on a colored block. */
const BLOCK_TRACK = 'rgba(0,0,0,0.15)';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1, minHeight: TILE_MIN_H, justifyContent: 'space-between' },
  tileMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  tileNumbers: { flex: 1, minWidth: 0 },
  // Local size between display(40) and title — two tile numbers must share a row's width.
  tileNumber: { fontSize: 28, lineHeight: 34 },
  netRow: { flexDirection: 'row', alignItems: 'baseline' },
  // Thick rounded in/out bars on the charcoal calories block (brief §7).
  barPair: { gap: spacing.sm },
  kcalBarTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  kcalBarFill: { height: '100%', borderRadius: radius.full },

  // ── Sheets ──────────────────────────────────────────────────
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  heroText: { flex: 1, minWidth: 0 },
  heroCaption: { marginTop: spacing.xs },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  barCell: { flex: 1, alignItems: 'center', gap: spacing.xs },
  barValue: { fontSize: 10, letterSpacing: 0.5 },
  barTrack: {
    width: 16,
    height: BAR_TRACK,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: radius.full },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 44,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  controlText: { flex: 1, minWidth: 0 },
  sheetButton: { marginTop: spacing.lg },
  explainer: { marginTop: spacing.lg },
  ioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  ioLabel: { width: 32 },
  ioTrack: {
    flex: 1,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  ioFill: { height: '100%', borderRadius: radius.full },
  ioValue: { minWidth: 56, textAlign: 'right' },
  breakdown: { marginTop: spacing.lg },
});

/** "12,540" — steps and kcal are always whole, grouped numbers. */
function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Compact bar-chart numeral: 9540 → "9540", 12,540 → "12.5K". */
function compactSteps(n: number): string {
  if (n >= 10_000) {
    const k = Math.round(n / 100) / 10;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

/** "3.2 km" with one decimal. */
function kmLabel(km: number): string {
  return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

export function ActivitySection({ stagger = 5 }: { stagger?: number }) {
  const activity = useActivityToday();
  const week = useStepsWeek();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [kcalOpen, setKcalOpen] = useState(false);

  return (
    <Animated.View entering={enterUp(stagger)}>
      <SectionLabel>Activity</SectionLabel>
      {!activity.loaded ? (
        <View style={styles.row}>
          <Skeleton height={TILE_MIN_H} radius={radius.block} style={{ flex: 1 }} />
          <Skeleton height={TILE_MIN_H} radius={radius.block} style={{ flex: 1 }} />
        </View>
      ) : (
        <View style={styles.row}>
          <StepsTile activity={activity} onPress={() => setStepsOpen(true)} />
          <CaloriesTile activity={activity} onPress={() => setKcalOpen(true)} />
        </View>
      )}

      <Sheet visible={stepsOpen} onClose={() => setStepsOpen(false)} title="Steps today">
        <StepsSheetBody activity={activity} week={week} />
      </Sheet>
      <Sheet visible={kcalOpen} onClose={() => setKcalOpen(false)} title="Calories today">
        <CaloriesSheetBody
          activity={activity}
          onLogFood={() => {
            // Close first so the Modal doesn't sit over the Food tab.
            setKcalOpen(false);
            router.push(FOOD_TAB_HREF);
          }}
        />
      </Sheet>
    </Animated.View>
  );
}

// ────────────────────────────────────────────────────────────────
// Tiles
// ────────────────────────────────────────────────────────────────

/**
 * The screen's cream counterpoint block (brief §2): black ring + big black
 * number on warm paper, secondary lines in `creamDim`.
 */
function StepsTile({ activity, onPress }: { activity: ActivityToday; onPress: () => void }) {
  const { steps, stepsGoal, distanceKm, supported } = activity;
  // No sensor and nothing logged: a hint beats a dead 0 (web / no hardware).
  const manualHint = !supported && steps === 0;
  return (
    <Card
      variant="cream"
      onPress={onPress}
      accessibilityLabel={`Steps today, ${grouped(steps)} of ${grouped(stepsGoal)}. Opens details`}
      style={styles.cell}
    >
      <AppText variant="label" color={colors.creamDim}>
        Steps
      </AppText>
      <View style={styles.tileMain}>
        <Ring
          progress={stepsGoal > 0 ? steps / stepsGoal : 0}
          size={48}
          strokeWidth={5}
          color={colors.onBlock}
          trackColor={BLOCK_TRACK}
          delay={350}
        />
        <View style={styles.tileNumbers}>
          {manualHint ? (
            <AppText variant="bodyBold" color={colors.creamDim}>
              Log manually
            </AppText>
          ) : (
            <AnimatedNumber
              value={steps}
              grouped
              variant="display"
              color={colors.onBlock}
              style={styles.tileNumber}
            />
          )}
          <AppText variant="caption" color={colors.creamDim} numberOfLines={1}>
            of {grouped(stepsGoal)}
          </AppText>
        </View>
      </View>
      <AppText variant="caption" color={colors.creamDim} numberOfLines={1}>
        {manualHint ? 'Tap to add steps' : kmLabel(distanceKm)}
      </AppText>
    </Card>
  );
}

/**
 * Charcoal calories block with the thick in/out bar pair (same encoding as
 * the sheet's In/Out rows: both scaled against the larger side).
 */
function CaloriesTile({ activity, onPress }: { activity: ActivityToday; onPress: () => void }) {
  const { netKcal, eatenKcal, caloriesOut } = activity;
  const maxSide = Math.max(1, eatenKcal, caloriesOut);
  return (
    <Card
      padding={spacing.gutter}
      onPress={onPress}
      accessibilityLabel={`Calories today, net ${netKcal > 0 ? 'plus' : ''} ${grouped(
        netKcal,
      )} kilocalories. Eaten ${grouped(eatenKcal)}, burned ${grouped(caloriesOut)}. Opens details`}
      style={styles.cell}
    >
      <AppText variant="label">Calories</AppText>
      <View style={styles.tileMain}>
        <View style={styles.tileNumbers}>
          <View style={styles.netRow}>
            {netKcal > 0 ? (
              <AppText variant="display" style={styles.tileNumber}>
                +
              </AppText>
            ) : null}
            <AnimatedNumber value={netKcal} grouped variant="display" style={styles.tileNumber} />
          </View>
          <AppText variant="caption" numberOfLines={1}>
            in {grouped(eatenKcal)} · out {grouped(caloriesOut)}
          </AppText>
        </View>
      </View>
      <View style={styles.barPair}>
        <View style={styles.kcalBarTrack}>
          <View
            style={[
              styles.kcalBarFill,
              { width: `${(eatenKcal / maxSide) * 100}%`, backgroundColor: colors.kcal },
            ]}
          />
        </View>
        <View style={styles.kcalBarTrack}>
          <View
            style={[
              styles.kcalBarFill,
              { width: `${(caloriesOut / maxSide) * 100}%`, backgroundColor: colors.blue },
            ]}
          />
        </View>
      </View>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Steps sheet
// ────────────────────────────────────────────────────────────────

function StepsSheetBody({
  activity,
  week,
}: {
  activity: ActivityToday;
  week: DaySteps[] | null;
}) {
  const targets = useProfile((s) => s.targets);
  const update = useProfile((s) => s.update);
  const [manual, setManual] = useState(500);
  const today = todayIso();

  // The week query is focus-cached; today's bar should show the live count.
  const days = (week ?? []).map((d) =>
    d.date === today ? { ...d, steps: Math.max(d.steps, activity.steps) } : d,
  );
  const maxSteps = Math.max(1, ...days.map((d) => d.steps));

  return (
    <View>
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <AnimatedNumber value={activity.steps} grouped variant="display" />
          <AppText variant="caption" color={colors.textDim} style={styles.heroCaption}>
            of {grouped(activity.stepsGoal)} steps today
          </AppText>
        </View>
        <Ring
          progress={activity.stepsGoal > 0 ? activity.steps / activity.stepsGoal : 0}
          size={80}
          strokeWidth={8}
          color={colors.accent}
        />
      </View>

      {days.length > 0 ? (
        <>
          <SectionLabel>Last 7 days</SectionLabel>
          <Animated.View entering={enterFade(0)} style={styles.bars}>
            {days.map((d) => {
              const isToday = d.date === today;
              const h = d.steps > 0 ? Math.max(6, (d.steps / maxSteps) * BAR_TRACK) : 0;
              return (
                <View
                  key={d.date}
                  style={styles.barCell}
                  accessible
                  accessibilityLabel={`${dayLabel(d.date)}${isToday ? ', today' : ''}: ${grouped(
                    d.steps,
                  )} steps`}
                >
                  <AppText
                    variant="label"
                    color={isToday ? colors.text : colors.textFaint}
                    style={styles.barValue}
                  >
                    {d.steps > 0 ? compactSteps(d.steps) : ' '}
                  </AppText>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: h,
                          backgroundColor: isToday ? colors.accent : colors.surfaceRaised,
                        },
                      ]}
                    />
                  </View>
                  <AppText variant="label" color={isToday ? colors.text : colors.textDim}>
                    {dayLabel(d.date).charAt(0)}
                  </AppText>
                </View>
              );
            })}
          </Animated.View>
        </>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <View style={styles.metaRow}>
          <AppText variant="body" color={colors.textDim}>
            Distance
          </AppText>
          <AppText variant="bodyBold" tabular>
            {kmLabel(activity.distanceKm)}
          </AppText>
        </View>
        <Divider />
        <View style={styles.metaRow}>
          <AppText variant="body" color={colors.textDim}>
            Steps burn
          </AppText>
          <AppText variant="bodyBold" tabular>
            {grouped(activity.stepsKcal)} kcal
          </AppText>
        </View>
        <Divider />
      </View>

      <View style={styles.controlRow}>
        <View style={styles.controlText}>
          <AppText variant="bodyBold">Daily goal</AppText>
          <AppText variant="caption">steps per day</AppText>
        </View>
        <Stepper
          label="Goal"
          value={targets.steps}
          step={500}
          min={1000}
          max={40000}
          format={grouped}
          onChange={(n) => update({ targets: { ...targets, steps: n } })}
        />
      </View>

      <View style={styles.controlRow}>
        <View style={styles.controlText}>
          <AppText variant="bodyBold">Add steps</AppText>
          <AppText variant="caption">manual entry</AppText>
        </View>
        <Stepper
          label="Steps"
          value={manual}
          step={250}
          min={250}
          max={20000}
          format={grouped}
          onChange={setManual}
        />
      </View>
      <Button
        label={`Add ${grouped(manual)} steps`}
        variant="secondary"
        onPress={() => {
          void activity.addManualSteps(manual);
        }}
        style={styles.sheetButton}
      />

      {activity.supported && activity.permission !== 'granted' ? (
        <Button
          label="Enable step tracking"
          onPress={() => {
            void requestStepPermission().then(() => activity.refresh());
          }}
          style={styles.sheetButton}
        />
      ) : null}

      <AppText variant="caption" color={colors.textFaint} style={styles.explainer}>
        Distance and calories are estimates from your steps, height and weight.
      </AppText>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Calories sheet
// ────────────────────────────────────────────────────────────────

function CaloriesSheetBody({
  activity,
  onLogFood,
}: {
  activity: ActivityToday;
  onLogFood: () => void;
}) {
  const { netKcal, eatenKcal, caloriesOut, restingKcal, stepsKcal, workoutKcal } = activity;
  const maxSide = Math.max(1, eatenKcal, caloriesOut);

  return (
    <View>
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <View style={styles.netRow}>
            {netKcal > 0 ? <AppText variant="display">+</AppText> : null}
            <AnimatedNumber value={netKcal} grouped variant="display" />
          </View>
          <AppText variant="caption" color={colors.textDim} style={styles.heroCaption}>
            net kcal · eaten minus burned
          </AppText>
        </View>
      </View>

      <View
        accessible
        accessibilityLabel={`Eaten ${grouped(eatenKcal)} kilocalories, burned ${grouped(
          caloriesOut,
        )} kilocalories`}
      >
        <View style={styles.ioRow}>
          <AppText variant="label" style={styles.ioLabel}>
            In
          </AppText>
          <View style={styles.ioTrack}>
            <View
              style={[
                styles.ioFill,
                { width: `${(eatenKcal / maxSide) * 100}%`, backgroundColor: colors.kcal },
              ]}
            />
          </View>
          <AppText variant="bodyBold" tabular style={styles.ioValue}>
            {grouped(eatenKcal)}
          </AppText>
        </View>
        <View style={styles.ioRow}>
          <AppText variant="label" style={styles.ioLabel}>
            Out
          </AppText>
          <View style={styles.ioTrack}>
            <View
              style={[
                styles.ioFill,
                { width: `${(caloriesOut / maxSide) * 100}%`, backgroundColor: colors.blue },
              ]}
            />
          </View>
          <AppText variant="bodyBold" tabular style={styles.ioValue}>
            {grouped(caloriesOut)}
          </AppText>
        </View>
      </View>

      <View style={styles.breakdown}>
        <BreakdownRow label="Food" value={`${grouped(eatenKcal)} kcal`} />
        <BreakdownRow label="Resting burn" value={`−${grouped(restingKcal)} kcal`} />
        <BreakdownRow label="Steps burn" value={`−${grouped(stepsKcal)} kcal`} />
        <BreakdownRow label="Workout burn" value={`−${grouped(workoutKcal)} kcal`} />
        <View style={styles.metaRow}>
          <AppText variant="bodyBold">Net</AppText>
          <AppText variant="bodyBold" tabular>
            {netKcal > 0 ? '+' : ''}
            {grouped(netKcal)} kcal
          </AppText>
        </View>
      </View>

      <Button label="Log food" onPress={onLogFood} style={styles.sheetButton} />

      <AppText variant="caption" color={colors.textFaint} style={styles.explainer}>
        Burn numbers are estimates from your profile and logged activity.
      </AppText>
    </View>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <View style={styles.metaRow}>
        <AppText variant="body" color={colors.textDim}>
          {label}
        </AppText>
        <AppText variant="bodyBold" tabular>
          {value}
        </AppText>
      </View>
      <Divider />
    </>
  );
}
