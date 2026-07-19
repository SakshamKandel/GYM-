import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';

/**
 * Self-contained location card for a gym's coordinates — a stylized,
 * brand-colored map motif drawn entirely with local SVG (streets grid + a
 * ring-road arc + block shapes seeded deterministically from the coords, so
 * each gym gets a subtly different "map"), the red pin at center, and the
 * coordinate readout. Replaces the previous OSM tile fetch: tile hotlinking
 * from apps violates the OSM tile usage policy and the tile server began
 * blocking us. This card needs NO network, works offline, and can never be
 * blocked. Tap hands off to the caller (existing Directions link) — this
 * component draws, it doesn't navigate.
 */

const BOX_W = 200;
const BOX_H = 200;
const PIN_SIZE = 30;

/** Tiny deterministic PRNG from the coords — same gym, same map motif. */
function seeded(lat: number, lng: number): () => number {
  let s = Math.abs(Math.sin(lat * 12.9898 + lng * 78.233) * 43758.5453) % 1;
  return () => {
    s = (s * 9301 + 0.49297) % 1;
    return s;
  };
}

interface Streets {
  verticals: number[];
  horizontals: number[];
  arc: string;
  blocks: { x: number; y: number; w: number; h: number }[];
}

function buildStreets(lat: number, lng: number): Streets {
  const rnd = seeded(lat, lng);
  const verticals = [0.22, 0.48, 0.74].map((f) => (f + (rnd() - 0.5) * 0.08) * BOX_W);
  const horizontals = [0.26, 0.52, 0.78].map((f) => (f + (rnd() - 0.5) * 0.08) * BOX_H);
  // A gentle "ring road" arc sweeping a corner.
  const sweep = rnd() > 0.5;
  const arc = sweep
    ? `M ${-20} ${BOX_H * 0.7} Q ${BOX_W * 0.45} ${BOX_H * 0.45} ${BOX_W + 20} ${BOX_H * 0.85}`
    : `M ${-20} ${BOX_H * 0.3} Q ${BOX_W * 0.55} ${BOX_H * 0.55} ${BOX_W + 20} ${BOX_H * 0.15}`;
  const blocks = Array.from({ length: 4 }, () => ({
    x: rnd() * (BOX_W - 46),
    y: rnd() * (BOX_H - 40),
    w: 26 + rnd() * 20,
    h: 18 + rnd() * 16,
  }));
  return { verticals, horizontals, arc, blocks };
}

const styles = StyleSheet.create({
  wrap: {
    width: BOX_W,
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  box: { width: BOX_W, height: BOX_H },
  pin: {
    position: 'absolute',
    left: BOX_W / 2 - PIN_SIZE / 2,
    top: BOX_H / 2 - PIN_SIZE,
  },
  coords: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.xs,
  },
  hint: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
});

interface Props {
  lat: number;
  lng: number;
  onPress?: () => void;
  /** Describes the tap action (e.g. "Open directions to <gym name>"). */
  accessibilityLabel: string;
}

export function MapPreview({ lat, lng, onPress, accessibilityLabel }: Props) {
  const streets = useMemo(() => buildStreets(lat, lng), [lat, lng]);

  const inner = (
    <View style={styles.box}>
      <Svg width={BOX_W} height={BOX_H} pointerEvents="none">
        {/* City blocks — barely-raised shapes behind the street grid. */}
        {streets.blocks.map((b, i) => (
          <Path
            key={i}
            d={`M ${b.x} ${b.y} h ${b.w} v ${b.h} h ${-b.w} Z`}
            fill={colors.surfaceRaised}
            opacity={0.55}
          />
        ))}
        {/* Street grid. */}
        {streets.verticals.map((x, i) => (
          <Line
            key={`v${i}`}
            x1={x}
            y1={-4}
            x2={x}
            y2={BOX_H + 4}
            stroke={colors.surfaceRaised}
            strokeWidth={5}
          />
        ))}
        {streets.horizontals.map((y, i) => (
          <Line
            key={`h${i}`}
            x1={-4}
            y1={y}
            x2={BOX_W + 4}
            y2={y}
            stroke={colors.surfaceRaised}
            strokeWidth={5}
          />
        ))}
        {/* Ring-road arc, faint accent. */}
        <Path d={streets.arc} stroke={colors.accentFaint} strokeWidth={6} fill="none" opacity={0.8} />
        {/* Landing ring under the pin. */}
        <Circle cx={BOX_W / 2} cy={BOX_H / 2 + 2} r={10} fill={colors.accentFaint} opacity={0.5} />
        <Circle cx={BOX_W / 2} cy={BOX_H / 2 + 2} r={3} fill={colors.accent} />
      </Svg>
      <View pointerEvents="none" style={styles.pin}>
        <Ionicons name="location" size={PIN_SIZE} color={colors.accent} />
      </View>
      <View pointerEvents="none" style={styles.coords}>
        <AppText variant="caption" color={colors.textDim}>
          {lat.toFixed(4)}, {lng.toFixed(4)}
        </AppText>
      </View>
      <View pointerEvents="none" style={styles.hint}>
        <Ionicons name="navigate" size={11} color={colors.textDim} />
        <AppText variant="caption" color={colors.textDim}>
          Directions
        </AppText>
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View style={styles.wrap} accessibilityLabel={accessibilityLabel} accessible>
        {inner}
      </View>
    );
  }

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.wrap}
    >
      {inner}
    </PressableScale>
  );
}
