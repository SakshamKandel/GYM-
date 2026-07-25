import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import type { UnitPref } from '@gym/shared';
import { displayWeight, PLATES_KG, platesFor } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { formatWeightNumber, plateInk, plateInventoryFor } from '../logic';

/**
 * Barbell side view: bar line + colored plate rectangles per side, from
 * platesFor(). Standard plate colors (heaviest red · then blue · yellow ·
 * green · white · fractionals dim). Drawn inside a canvas-dip inner
 * tile (`radius.md`, `colors.bg`) — nested-tile chrome per the block
 * language; separation by fill contrast, no strokes.
 *
 * Everything on screen is in the member's OWN unit: a member on pounds gets
 * a 45 lb bar and 45/35/25 plates, not the kilo rack converted to decimals.
 * The canonical weight stays kg (as everywhere); it's converted once here.
 */

interface Props {
  /** Canonical target weight, always kg. */
  weightKg: number;
  /** Which rack to load, and which unit the captions speak. */
  unitPref: UnitPref;
}

const VB_W = 280;
const VB_H = 60;
const BAR_Y = VB_H / 2;
const COLLAR_X = 84;
const PLATE_GAP = 3;

interface PlateGeometry {
  w: number;
  h: number;
}

/** Kilogram-plate geometry ladder — the source the rank ramp is derived from. */
function plateSizeKg(kg: number): PlateGeometry {
  if (kg >= 20) return { w: 13, h: 52 };
  if (kg >= 15) return { w: 11, h: 42 };
  if (kg >= 10) return { w: 11, h: 34 };
  if (kg >= 5) return { w: 9, h: 26 };
  if (kg >= 2.5) return { w: 8, h: 20 };
  return { w: 7, h: 14 };
}

/**
 * Geometry ramp, heaviest first, index-aligned with an inventory's `plates`
 * (same derivation as the ink ramp in ../logic): the kg strip draws exactly
 * as before, and a pound rack steps down through the same silhouettes.
 */
const PLATE_SIZES: readonly PlateGeometry[] = PLATES_KG.map((kg) => plateSizeKg(kg));
const SMALLEST_PLATE: PlateGeometry = { w: 7, h: 14 };

function plateSize(denomination: number, plates: readonly number[]): PlateGeometry {
  const rank = plates.indexOf(denomination);
  if (rank < 0) return SMALLEST_PLATE;
  return PLATE_SIZES[Math.min(rank, PLATE_SIZES.length - 1)] ?? SMALLEST_PLATE;
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

export function PlateStrip({ weightKg, unitPref }: Props) {
  const inventory = plateInventoryFor(unitPref);
  // platesFor is unit-agnostic arithmetic — feed it target, bar and plates all
  // in the display unit and every number it returns is in that unit too.
  const target = displayWeight(weightKg, unitPref);
  const breakdown = platesFor(target, inventory.barWeight, inventory.plates);
  const emptyBar = target <= inventory.barWeight || breakdown.perSide.length === 0;

  let x = COLLAR_X + PLATE_GAP;
  const plates = breakdown.perSide.map((denomination, i) => {
    const { w, h } = plateSize(denomination, inventory.plates);
    const rect = { key: `${denomination}-${i}`, x, denomination, w, h };
    x += w + PLATE_GAP;
    return rect;
  });

  const caption = emptyBar
    ? `empty bar · ${formatWeightNumber(inventory.barWeight)} ${unitPref}`
    : `per side: ${breakdown.perSide.map(formatWeightNumber).join(' · ')} ${unitPref}`;

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
            fill={plateInk(p.denomination, inventory)}
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
            {`+${formatWeightNumber(breakdown.remainder)} ${unitPref} won't load`}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
