import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { displayWeight, inputToKg, projectGoal, unitLabel } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AnimatedNumber,
  AppText,
  Button,
  enterFade,
  IconChip,
  PressableScale,
  Stepper,
} from '../../../components/ui';
import { logHaptic } from '../../../lib/haptics';
import { useProfile } from '../../../state/profile';

/**
 * Goal projection (Feature Blueprint §02): weeks-to-target at the current
 * trend rate. No target yet → ghost row that reveals an inline stepper
 * editor (no keyboard). tooFast keeps its guardrail line in warning color —
 * semantic, not decoration.
 */

interface Props {
  /** Latest smoothed trend weight, canonical kg (null = no weigh-ins yet). */
  trendKg: number | null;
  /** Current trend rate, kg/week (signed). */
  ratePerWeekKg: number;
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  goalLabel: { flexShrink: 1, minWidth: 0 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: touch.min,
    paddingHorizontal: spacing.sm,
    // Big touch target without inflating the header row visually.
    marginVertical: -spacing.md,
    marginRight: -spacing.sm,
  },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  ghostRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    minHeight: 64,
  },
  ghostLabel: { flex: 1 },
  stepperWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  saveBtn: { minHeight: touch.min },
});

export function GoalProjectionCard({ trendKg, ratePerWeekKg }: Props) {
  const unitPref = useProfile((s) => s.unitPref);
  const targetWeightKg = useProfile((s) => s.targetWeightKg);
  const startWeightKg = useProfile((s) => s.startWeightKg);
  const update = useProfile((s) => s.update);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(0);

  const unit = unitLabel(unitPref);

  function openEditor(): void {
    // Default = current trend; fall back to an existing target / start weight.
    const baseKg = targetWeightKg ?? trendKg ?? startWeightKg ?? 75;
    setDraft(displayWeight(baseKg, unitPref));
    setEditing(true);
  }

  function saveTarget(): void {
    update({ targetWeightKg: inputToKg(draft, unitPref) });
    logHaptic();
    setEditing(false);
  }

  if (editing) {
    return (
      <Animated.View entering={enterFade(0)} style={styles.card}>
        <View style={styles.stepperWrap}>
          <Stepper
            value={draft}
            onChange={setDraft}
            step={0.5}
            min={unitPref === 'kg' ? 30 : 66}
            max={unitPref === 'kg' ? 350 : 770}
            label={`Target (${unit})`}
            format={(v) => v.toFixed(1)}
          />
        </View>
        <View style={styles.actionsRow}>
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
          <Button label="Save" onPress={saveTarget} style={styles.saveBtn} />
        </View>
      </Animated.View>
    );
  }

  if (targetWeightKg === null) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Set a target weight"
        onPress={openEditor}
        style={styles.ghostRow}
      >
        <IconChip icon="flag-outline" iconColor={colors.textDim} />
        <AppText variant="bodyBold" color={colors.textDim} style={styles.ghostLabel}>
          Set a target weight
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </PressableScale>
    );
  }

  const projection =
    trendKg !== null ? projectGoal({ trendKg, targetKg: targetWeightKg, ratePerWeekKg }) : null;
  const tooFast = projection?.status === 'tooFast';

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <AppText variant="label" numberOfLines={1} style={styles.goalLabel}>
          Goal · {displayWeight(targetWeightKg, unitPref).toFixed(1)} {unit}
        </AppText>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Edit target weight"
          onPress={openEditor}
          style={styles.editBtn}
        >
          <Ionicons name="pencil" size={14} color={colors.textDim} />
          <AppText variant="caption">Edit</AppText>
        </PressableScale>
      </View>

      {projection !== null && projection.etaWeeks !== null ? (
        <View style={styles.etaRow}>
          <AnimatedNumber value={projection.etaWeeks} variant="display" />
          <AppText variant="label">Weeks to target</AppText>
        </View>
      ) : null}

      {projection !== null ? (
        <AppText
          variant={tooFast ? 'caption' : 'body'}
          color={tooFast ? colors.warning : undefined}
        >
          {projection.message}
        </AppText>
      ) : (
        <AppText variant="caption">Log weigh-ins and your timeline appears here.</AppText>
      )}
    </View>
  );
}
