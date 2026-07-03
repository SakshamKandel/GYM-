import { StyleSheet, View } from 'react-native';
import { colors } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { Ring } from './Ring';

/**
 * A small labelled macro ring — the circular sibling of MacroBar. Shows one
 * macro's progress as a crisp arc (adherence-neutral: over target completes the
 * ring, never turns red) with the current grams centred and a label below.
 * Used by the Food hero and the portion screen so both speak the same visual
 * language.
 */
interface Props {
  label: string;
  current: number;
  /** Target grams; when absent/zero the ring just shows the value with no arc. */
  target?: number;
  color: string;
  unit?: string;
  size?: number;
  strokeWidth?: number;
  /** Delay before the arc sweeps in (stagger a row of rings). */
  delay?: number;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  center: { alignItems: 'center' },
  value: { fontSize: 18, lineHeight: 20 },
});

export function MacroRing({
  label,
  current,
  target,
  color,
  unit = 'g',
  size = 64,
  strokeWidth = 6,
  delay = 0,
}: Props) {
  const rounded = Math.round(current);
  const progress = target && target > 0 ? current / target : 0;
  return (
    <View
      style={styles.wrap}
      accessibilityLabel={
        target
          ? `${label}: ${rounded} of ${Math.round(target)} ${unit}`
          : `${label}: ${rounded} ${unit}`
      }
    >
      <Ring size={size} strokeWidth={strokeWidth} progress={progress} color={color} delay={delay}>
        <View style={styles.center}>
          <AppText variant="display" style={styles.value} tabular>
            {rounded}
          </AppText>
          <AppText variant="caption" color={colors.textDim} tabular={false}>
            {unit}
          </AppText>
        </View>
      </Ring>
      <AppText variant="label">{label}</AppText>
    </View>
  );
}
