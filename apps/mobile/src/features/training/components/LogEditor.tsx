import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { UnitPref } from '@gym/shared';
import { displayWeight, inputToKg } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, Chip, Stepper } from '../../../components/ui';
import { formatWeightNumber, prefillFor } from '../logic';
import { useSession, type SessionExercise } from '../session';
import { PlateStrip } from './PlateStrip';

/**
 * The thumb-zone editor: big weight + reps steppers (no keyboard), plate
 * calculator for barbell work, optional RPE chips, one full-width LOG SET.
 * Steppers are stacked — two 200dp-wide Stepper rows physically cannot sit
 * side by side on a 360–393dp phone, and gym mode never sacrifices targets.
 */

interface Props {
  exercise: SessionExercise;
  unitPref: UnitPref;
  onLog: (weightKg: number, reps: number) => void;
  logging: boolean;
  /** Progression target the user tapped Apply on (canonical kg) — prefill override. */
  appliedSuggestion?: { weightKg: number; reps: number } | null;
}

/** Meaningful effort ratings only — below 6 nobody bothers to rate. */
const RPE_OPTIONS = [6, 7, 8, 9, 10] as const;

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: spacing.sm },
  steppers: { alignItems: 'center', gap: spacing.md },
  rpeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  rpeLabel: { marginRight: spacing.xs },
  button: { alignSelf: 'stretch', marginTop: spacing.md },
});

export function LogEditor({ exercise, unitPref, onLog, logging, appliedSuggestion }: Props) {
  const [weight, setWeight] = useState(0); // display units
  const [reps, setReps] = useState(10);
  // Staged in the session store so commitSet can attach it to the saved set.
  const pendingRpe = useSession((s) => s.pendingRpe);

  const loggedCount = exercise.loggedSets.length;

  useEffect(() => {
    const p = prefillFor({
      sessionSets: exercise.loggedSets,
      lastSets: exercise.lastSets,
      repRange: exercise.repRange,
      suggested: appliedSuggestion ?? null,
    });
    setWeight(displayWeight(p.weightKg, unitPref));
    setReps(p.reps);
    // Re-prefill when the exercise, its set count, ghost data, or an applied
    // suggestion changes. The suggestion is keyed on its primitive values, not
    // the object reference — a parent re-render (e.g. the 1s elapsed clock)
    // must never clobber the user's manual stepper adjustments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    exercise.exerciseId,
    loggedCount,
    exercise.lastSets,
    unitPref,
    appliedSuggestion?.weightKg,
    appliedSuggestion?.reps,
  ]);

  const weightKg = inputToKg(weight, unitPref);
  const setLabel = `Set ${loggedCount + 1}${exercise.repRange ? ` · target ${exercise.repRange}` : ''}`;

  return (
    <View>
      <View style={styles.header}>
        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
          {exercise.exerciseName}
        </AppText>
        <AppText variant="label" color={colors.textFaint}>
          {setLabel}
        </AppText>
      </View>
      <View style={styles.steppers}>
        <Stepper
          label={`weight · ${unitPref}`}
          value={weight}
          onChange={setWeight}
          step={unitPref === 'kg' ? 2.5 : 5}
          min={0}
          format={formatWeightNumber}
        />
        <Stepper label="reps" value={reps} onChange={setReps} step={1} min={1} max={100} />
      </View>
      {exercise.equipment === 'barbell' ? <PlateStrip weightKg={weightKg} /> : null}
      {/* Optional effort rating — tap again to clear; never blocks LOG SET. */}
      <View style={styles.rpeRow}>
        <AppText variant="label" color={colors.textFaint} style={styles.rpeLabel}>
          RPE
        </AppText>
        {RPE_OPTIONS.map((v) => (
          <Chip
            key={v}
            label={String(v)}
            selected={pendingRpe === v}
            onPress={() => useSession.getState().setPendingRpe(pendingRpe === v ? null : v)}
          />
        ))}
      </View>
      <Button
        label="LOG SET"
        onPress={() => onLog(weightKg, reps)}
        loading={logging}
        style={styles.button}
        accessibilityLabel={`Log set: ${formatWeightNumber(weight)} ${unitPref} for ${reps} reps`}
      />
    </View>
  );
}
