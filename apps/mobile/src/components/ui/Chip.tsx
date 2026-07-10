import { StyleSheet } from 'react-native';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Interactive filter chip (REVAMP-BRIEF §6): full pill, outlined 1.5px
 * `borderStrong` on dark; selected = solid red fill with BLACK label
 * (black-on-red brand law). Chips are allowed borders — the no-border law
 * is for cards. ≥48dp tap target.
 */
interface Props {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Render INSIDE a red/cream block: filled near-black pill, light label. */
  onBlock?: boolean;
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
  onBlock: { backgroundColor: colors.onBlock, borderColor: colors.onBlock },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

export function Chip({ label, selected = false, onPress, onBlock = false }: Props) {
  const labelColor = selected
    ? colors.onBlock
    : onBlock
      ? colors.text
      : colors.textDim;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress ?? (() => undefined)}
      style={[styles.chip, onBlock && styles.onBlock, selected && styles.selected]}
    >
      <AppText style={styles.text} color={labelColor} tabular={false} numberOfLines={1}>
        {label}
      </AppText>
    </PressableScale>
  );
}
