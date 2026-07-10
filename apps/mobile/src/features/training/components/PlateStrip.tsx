import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { DEFAULT_BAR_KG, platesFor } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { formatWeightNumber, plateColor } from '../logic';

/**
 * Barbell side view: bar line + colored plate rectangles per side, from
 * platesFor(). Standard plate colors (25 red · 20 blue · 15 yellow ·
 * 10 green · 5 white · fractionals dim). Drawn inside a canvas-dip inner
 * tile (`radius.md`, `colors.bg`) — nested-tile chrome per the block
 * language; separation by fill contrast, no strokes.
 */

interface Props {
  weightKg: number;
}

const VB_W = 280;
const VB_H = 60;
const BAR_Y = VB_H / 2;
const COLLAR_X = 84;
const PLATE_GAP = 3;

function plateSize(kg: number): { w: number; h: number } {
  if (kg >= 20) return { w: 13, h: 52 };
  if (kg >= 15) return { w: 11, h: 42 };
  if (kg >= 10) return { w: 11, h: 34 };
  if (kg >= 5) return { w: 9, h: 26 };
  if (kg >= 2.5) return { w: 8, h: 20 };
  return { w: 7, h: 14 };
}

const styles = StyleSheet.create({
  root: { marginVertical: spacing.sm },
  /** Canvas-colored inner tile framing the barbell drawing. */
  tile: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});

export function PlateStrip({ weightKg }: Props) {
  const breakdown = platesFor(weightKg);
  const emptyBar = weightKg <= DEFAULT_BAR_KG || breakdown.perSide.length === 0;

  let x = COLLAR_X + PLATE_GAP;
  const plates = breakdown.perSide.map((kg, i) => {
    const { w, h } = plateSize(kg);
    const rect = { key: `${kg}-${i}`, x, kg, w, h };
    x += w + PLATE_GAP;
    return rect;
  });

  const caption = emptyBar
    ? `empty bar · ${DEFAULT_BAR_KG} kg`
    : `per side: ${breakdown.perSide.map(formatWeightNumber).join(' · ')}`;

  return (
    <View style={styles.root} accessibilityLabel={`Plate calculator. ${caption}`}>
      <View style={styles.tile}>
        <Svg width="100%" height={VB_H} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        {/* bar */}
        <Line
          x1={8}
          y1={BAR_Y}
          x2={VB_W - 8}
          y2={BAR_Y}
          stroke={colors.borderStrong}
          strokeWidth={5}
          strokeLinecap="round"
        />
        {/* collar */}
        <Rect
          x={COLLAR_X - 7}
          y={BAR_Y - 9}
          width={7}
          height={18}
          rx={2}
          fill={colors.textFaint}
        />
        {/* bar end nub */}
        <Circle cx={VB_W - 8} cy={BAR_Y} r={4} fill={colors.borderStrong} />
        {plates.map((p) => (
          <Rect
            key={p.key}
            x={p.x}
            y={BAR_Y - p.h / 2}
            width={p.w}
            height={p.h}
            rx={2.5}
            fill={plateColor(p.kg)}
          />
        ))}
        </Svg>
      </View>
      <View style={styles.captionRow}>
        <AppText variant="caption" color={colors.textDim} tabular>
          {caption}
        </AppText>
        {breakdown.remainder > 0 ? (
          <AppText variant="caption" color={colors.warning} tabular>
            {`+${formatWeightNumber(breakdown.remainder)} kg won't load`}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
