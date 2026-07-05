import { StyleSheet, View } from 'react-native';
import type { UnitPref } from '@gym/shared';
import { displayWeight } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, PressableScale, Tag } from '../../../components/ui';
import { formatWeightNumber } from '../../training/logic';
import type { SuggestionView } from '../hooks';

/**
 * Suggested next target for the current exercise — sits above the log editor
 * and speaks the ghost-row language (26pt display numbers in textFaint, the
 * PR-tag outline chip). One tap pipes weight + reps into the editor; a
 * coach-reviewed suggestion gets a quiet "Reviewed by your coach" caption.
 * Clean and still: no glow, no pulsing — just the shared press spring.
 */

interface Props {
  suggestion: SuggestionView;
  unitPref: UnitPref;
  /** True once the target has been piped into the editor (chip flips, tap disarms). */
  applied: boolean;
  onApply: (weightKg: number, reps: number) => void;
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    justifyContent: 'center',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ghostNumbers: {
    fontFamily: type.display,
    fontSize: 26,
    color: colors.textFaint,
  },
  reason: { marginTop: 2 },
});

/** "62.5 × 8–12" in the user's display unit (weight stays canonical kg upstream). */
function fmtTarget(s: SuggestionView, unitPref: UnitPref): string {
  const weight = formatWeightNumber(displayWeight(s.weightKg, unitPref));
  const reps = s.repsMin === s.repsMax ? String(s.repsMin) : `${s.repsMin}–${s.repsMax}`;
  return `${weight} × ${reps}`;
}

export function SuggestionRow({ suggestion, unitPref, applied, onApply }: Props) {
  const target = fmtTarget(suggestion, unitPref);
  return (
    <PressableScale
      style={styles.row}
      disabled={applied}
      onPress={() => onApply(suggestion.weightKg, suggestion.repsMin)}
      accessibilityRole="button"
      accessibilityLabel={`Apply suggested target: ${formatWeightNumber(
        displayWeight(suggestion.weightKg, unitPref),
      )} ${unitPref} for ${suggestion.repsMin} reps`}
    >
      <View style={styles.top}>
        <Tag
          label={applied ? 'Applied' : 'Suggested'}
          variant={applied ? 'dim' : 'outline'}
          color={colors.accent}
        />
        <AppText style={styles.ghostNumbers} tabular>
          {target}
        </AppText>
      </View>
      <AppText variant="caption" color={colors.textDim} style={styles.reason} numberOfLines={2}>
        {suggestion.reason}
      </AppText>
      {suggestion.reviewed ? (
        <AppText variant="caption" color={colors.success} numberOfLines={2}>
          {suggestion.coachNote
            ? `Reviewed by your coach — ${suggestion.coachNote}`
            : 'Reviewed by your coach'}
        </AppText>
      ) : null}
    </PressableScale>
  );
}
