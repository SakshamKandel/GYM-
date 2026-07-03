import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@gym/ui-tokens';
import { AppText } from './AppText';

/**
 * The signature stat unit: uppercase micro-label above a big Bebas number
 * with a small unit suffix. Lime only when the value is "achieved/current".
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
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
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
