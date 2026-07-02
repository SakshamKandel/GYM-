import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Colorful category tile (reference: Technique 16 MIN / Tactics 10 MIN).
 * Solid color block, darker inner icon chip, big condensed number.
 */
interface Props {
  title: string;
  value: string | number;
  unit?: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string; // tile fill
  deepColor: string; // icon chip fill
  textColor?: string;
  onPress?: () => void;
  width?: number;
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 148,
    justifyContent: 'space-between',
  },
  title: { fontFamily: type.bodySemiBold, fontSize: 18 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  iconChip: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  value: { fontFamily: type.display, fontSize: 40 },
  unit: { fontFamily: type.bodySemiBold, fontSize: 12, letterSpacing: 1 },
});

export function CategoryTile({
  title,
  value,
  unit,
  icon,
  color,
  deepColor,
  textColor = colors.onAccent,
  onPress,
  width,
}: Props) {
  return (
    <PressableScale
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}: ${value} ${unit ?? ''}`}
      onPress={onPress ?? (() => undefined)}
      style={[styles.tile, { backgroundColor: color }, width !== undefined ? { width } : null]}
    >
      <AppText style={[styles.title, { color: textColor }]} tabular={false}>
        {title}
      </AppText>
      <View style={styles.bottomRow}>
        <View style={[styles.iconChip, { backgroundColor: deepColor }]}>
          <Ionicons name={icon} size={26} color={textColor} />
        </View>
        <View style={styles.valueRow}>
          <AppText style={[styles.value, { color: textColor }]} tabular>
            {value}
          </AppText>
          {unit ? (
            <AppText style={[styles.unit, { color: textColor }]} tabular={false}>
              {unit.toUpperCase()}
            </AppText>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}
