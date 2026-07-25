import { StyleSheet } from 'react-native';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';

/**
 * A delivery-slot chip for the checkout picker. Same pill language as the
 * shared `Chip` (full pill, 1.5px `borderStrong`, red fill when selected,
 * ≥48dp target) with the one thing a slot picker needs that a filter chip
 * doesn't: a REAL disabled state.
 *
 * A slot past its ordering cutoff can't be picked, and until now those chips
 * looked identical to live ones and simply swallowed the tap — the member kept
 * pressing a button that never did anything. Disabled chips now read as
 * unavailable (dimmed, no press animation) and announce themselves as disabled
 * with the reason in their label, so a screen-reader user learns why instead of
 * meeting silence.
 */

interface Props {
  label: string;
  selected: boolean;
  disabled?: boolean;
  /** Spoken instead of `label` when disabled — says WHY it can't be picked. */
  disabledHint?: string;
  onPress: () => void;
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.gutter,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  disabled: { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.5 },
  text: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

export function SlotChip({ label, selected, disabled = false, disabledHint, onPress }: Props) {
  const labelColor = disabled ? colors.textFaint : selected ? colors.onBlock : colors.textDim;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: selected && !disabled, disabled }}
      accessibilityLabel={disabled && disabledHint ? `${label}. ${disabledHint}` : label}
      disabled={disabled}
      // No spring on a chip that can't be chosen — the press feedback itself
      // would read as "that worked".
      pressScale={disabled ? 1 : 0.96}
      onPress={onPress}
      style={[styles.chip, selected && !disabled && styles.selected, disabled && styles.disabled]}
    >
      <AppText style={styles.text} color={labelColor} tabular={false} numberOfLines={1}>
        {label}
      </AppText>
    </PressableScale>
  );
}
