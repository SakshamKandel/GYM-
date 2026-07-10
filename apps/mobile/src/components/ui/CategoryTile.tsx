import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Bold color-block tile (revamp): flat sticker block, chunky `radius.block`
 * corners, darker inner icon chip, big condensed number. Text goes BLACK on
 * red/cream-ish (bright) fills and white on dark fills — picked by contrast,
 * overridable via `textColor`.
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

/**
 * True when black text has more contrast than white on the given hex fill
 * (relative luminance above ~0.179 — the WCAG crossover point). Non-hex
 * strings fall back to white text.
 */
function blackTextOn(fill: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(fill)?.[1];
  if (!hex) return false;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * lin(parseInt(hex.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(hex.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(hex.slice(4, 6), 16));
  return luminance > 0.179;
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.block,
    padding: spacing.gutter,
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
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flexShrink + minWidth:0 lets the number shrink to fit rather than pushing
  // past the tile's right edge when the value is long (e.g. "12.5k").
  valueWrap: { flexShrink: 1, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, justifyContent: 'flex-end' },
  value: { fontFamily: type.display, fontSize: 32, flexShrink: 1 },
  unit: { fontFamily: type.bodySemiBold, fontSize: 12, letterSpacing: 1 },
});

export function CategoryTile({
  title,
  value,
  unit,
  icon,
  color,
  deepColor,
  textColor,
  onPress,
  width,
}: Props) {
  const resolvedText =
    textColor ?? (blackTextOn(color) ? colors.onBlock : colors.onAccent);
  return (
    <PressableScale
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={unit ? `${title}: ${value} ${unit}` : `${title}: ${value}`}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.tile, { backgroundColor: color }, width !== undefined ? { width } : null]}
    >
      <AppText style={[styles.title, { color: resolvedText }]} tabular={false}>
        {title}
      </AppText>
      <View style={styles.bottomRow}>
        <View style={[styles.iconChip, { backgroundColor: deepColor }]}>
          <Ionicons name={icon} size={26} color={resolvedText} />
        </View>
        <View style={[styles.valueWrap, styles.valueRow]}>
          <AppText
            style={[styles.value, { color: resolvedText }]}
            tabular
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {value}
          </AppText>
          {unit ? (
            <AppText style={[styles.unit, { color: resolvedText }]} tabular={false}>
              {unit.toUpperCase()}
            </AppText>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}
