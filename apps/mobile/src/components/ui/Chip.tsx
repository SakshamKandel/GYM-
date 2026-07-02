import { StyleSheet } from 'react-native';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Filter chip (reference: TRACKER / PB / ACHIEVEMENTS row).
 * Outlined pill; selected = brighter border + white text.
 */
interface Props {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 20,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { borderColor: colors.text },
  text: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

export function Chip({ label, selected = false, onPress }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress ?? (() => undefined)}
      style={[styles.chip, selected && styles.selected]}
    >
      <AppText
        style={styles.text}
        color={selected ? colors.text : colors.textDim}
        tabular={false}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}
