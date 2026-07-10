import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';

/**
 * The signature stat unit: uppercase Oswald eyebrow above a big condensed
 * number with a small dim unit suffix (brief §7: big numbers always get an
 * eyebrow label). Red only when the value is "achieved/current". Inline —
 * it lives INSIDE blocks/rows, so it stays fill-free.
 */
interface Props {
  label: string;
  value: string | number;
  unit?: string;
  size?: 'display' | 'stat' | 'statHuge';
  accent?: boolean;
  align?: 'left' | 'center';
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, minWidth: 0 },
  center: { alignItems: 'center' },
  value: { flexShrink: 1 },
});

export function StatBlock({
  label,
  value,
  unit,
  size = 'display',
  accent = false,
  align = 'left',
  style,
}: Props) {
  const color = accent ? colors.accent : colors.text;
  return (
    <View style={[align === 'center' ? styles.center : null, style]}>
      <AppText variant="label" numberOfLines={1}>{label}</AppText>
      <View style={styles.row}>
        <AppText
          variant={size}
          color={color}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={styles.value}
        >
          {value}
        </AppText>
        {unit ? (
          <AppText variant="caption" color={colors.textDim}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
