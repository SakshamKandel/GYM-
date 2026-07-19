import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SetLog, UnitPref } from '@gym/shared';
import { displayWeight, inputToKg } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, ConfirmDialog, Stepper } from '../../../components/ui';
import { formatWeightNumber } from '../logic';

/**
 * Edit/delete sheet for an already-logged set (fixes: a mistap used to be
 * permanent). Opened via long-press on a DONE set row; steppers prefill from
 * the logged values, Save re-checks the PR flag server-side (session.ts),
 * Delete routes through a branded confirm before removing anything.
 */

interface Props {
  set: SetLog;
  unitPref: UnitPref;
  onSave: (weightKg: number, reps: number) => void;
  onDelete: () => void;
  saving?: boolean;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  steppers: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});

export function SetActionSheet({ set, unitPref, onSave, onDelete, saving }: Props) {
  const [weight, setWeight] = useState(() => displayWeight(set.weightKg, unitPref));
  const [reps, setReps] = useState(set.reps);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-seed the steppers whenever a different set is opened into this sheet.
  useEffect(() => {
    setWeight(displayWeight(set.weightKg, unitPref));
    setReps(set.reps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.id]);

  return (
    <View style={styles.wrap}>
      <AppText variant="caption" color={colors.textDim}>
        {`Set ${set.setNo} · ${set.exerciseName}`}
      </AppText>
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
      <View style={styles.actions}>
        <Button
          label="Save changes"
          onPress={() => onSave(inputToKg(weight, unitPref), reps)}
          loading={saving}
          accessibilityLabel={`Save set ${set.setNo}: ${formatWeightNumber(weight)} ${unitPref} for ${reps} reps`}
        />
        <Button
          label="Delete set"
          variant="danger"
          onPress={() => setConfirmDelete(true)}
          accessibilityLabel={`Delete set ${set.setNo}`}
        />
      </View>
      <ConfirmDialog
        visible={confirmDelete}
        title="Delete this set?"
        message={`Remove set ${set.setNo} — ${formatWeightNumber(displayWeight(set.weightKg, unitPref))} ${unitPref} × ${set.reps}. This can't be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}
