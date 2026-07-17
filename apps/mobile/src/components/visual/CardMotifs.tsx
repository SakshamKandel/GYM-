import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { colors, radius } from '@gym/ui-tokens';

/**
 * CardMotifs — purely decorative SVG backdrops that sit BEHIND a card's
 * content to add depth and life without imagery clutter. Same design laws as
 * EmptyArt: flat token fills only (no gradient primitives — opacity layering
 * only), no motion, hidden from accessibility (the card's own text carries all
 * meaning). Each motif self-clips to `radius.block` corners so it never spills
 * past the card, and fills the whole card box via absolute positioning.
 *
 * Contrast is the load-bearing constraint:
 * - On the RED hero, motifs use only `blockRedGlow` / white — tints LIGHTER
 *   than `blockRed`. A lighter underlay can only raise black `onBlock`
 *   contrast, never lower it, so text stays ≥4.5:1 even where a stroke passes
 *   beneath a glyph. (A darker red would drop it — hence never.)
 * - On CHARCOAL cards, motifs use `surfaceRaised` / `accentFaint` / `accent`
 *   at low opacity; white text on any of these stays far above 4.5:1.
 */

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.block,
    overflow: 'hidden',
  },
});

/** Wraps a motif so it fills + clips its card, and is invisible to a11y. */
function Motif({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={styles.clip}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        {children}
      </Svg>
    </View>
  );
}

/** Time-of-day phase for the hero glow — origin height + intensity only, all
 * red-family (no new hue). Morning sits high and bright; night dims and settles. */
function heroPhase(hour: number): { cy: number; intensity: number } {
  if (hour >= 5 && hour < 11) return { cy: 16, intensity: 1 }; // sunrise — high, bright
  if (hour >= 11 && hour < 17) return { cy: 10, intensity: 0.9 }; // midday — top-right blaze
  if (hour >= 17 && hour < 22) return { cy: 30, intensity: 0.72 }; // evening — lower, softer
  return { cy: 22, intensity: 0.5 }; // night — dim ember
}

/**
 * Hero energy glow — a radiant burst in the top-right of the red block:
 * overlapping translucent glow discs, a few concentric energy arcs, spark
 * dots and quiet rays. Lighter-than-red only, so black hero ink stays legible
 * everywhere. Shifts subtly with the time of day.
 */
export function HeroGlow({ hour }: { hour: number }) {
  const { cy, intensity } = heroPhase(hour);
  const glow = colors.blockRedGlow;
  const ray = colors.text; // white, used only at very low opacity
  return (
    <Motif>
      {/* Soft radial glow — overlapping filled discs stand in for a gradient. */}
      <Circle cx={86} cy={cy} r={54} fill={glow} opacity={0.1 * intensity} />
      <Circle cx={86} cy={cy} r={36} fill={glow} opacity={0.14 * intensity} />
      <Circle cx={86} cy={cy} r={20} fill={glow} opacity={0.2 * intensity} />
      <Circle cx={86} cy={cy} r={9} fill={glow} opacity={0.28 * intensity} />
      {/* Concentric energy arcs radiating from the corner. */}
      <G fill="none" stroke={glow} strokeWidth={1.3}>
        <Circle cx={98} cy={cy - 4} r={42} opacity={0.22 * intensity} />
        <Circle cx={98} cy={cy - 4} r={58} opacity={0.16 * intensity} />
        <Circle cx={98} cy={cy - 4} r={76} opacity={0.1 * intensity} />
      </G>
      {/* Quiet rays sweeping down-left from the light source. */}
      <G stroke={ray} strokeWidth={1} strokeLinecap="round">
        <Line x1={90} y1={cy} x2={52} y2={cy + 40} opacity={0.05 * intensity} />
        <Line x1={96} y1={cy + 6} x2={60} y2={cy + 54} opacity={0.045 * intensity} />
      </G>
      {/* Spark dots catching the light. */}
      <Circle cx={70} cy={cy + 3} r={1.6} fill={glow} opacity={0.5 * intensity} />
      <Circle cx={62} cy={cy + 14} r={1.1} fill={glow} opacity={0.4 * intensity} />
      <Circle cx={80} cy={cy + 22} r={1.3} fill={glow} opacity={0.36 * intensity} />
    </Motif>
  );
}

/**
 * Progress-report motif — a faint rising bar chart tucked into the lower-right
 * of the charcoal card, tipping the tallest bar with a quiet red spark. Reads
 * as "things are climbing" behind the stats, never fighting them.
 */
export function ProgressMotif() {
  const bar = colors.surfaceRaised;
  return (
    <Motif>
      <G opacity={0.9}>
        <Rect x={60} y={72} width={7} height={14} rx={2} fill={bar} opacity={0.55} />
        <Rect x={71} y={64} width={7} height={22} rx={2} fill={bar} opacity={0.6} />
        <Rect x={82} y={54} width={7} height={32} rx={2} fill={bar} opacity={0.65} />
        {/* Red spark on the leading bar. */}
        <Rect x={82} y={54} width={7} height={5} rx={2} fill={colors.accent} opacity={0.5} />
      </G>
    </Motif>
  );
}

/**
 * Weight-trend motif — a smoothed EWMA-style curve sweeping up across the
 * lower band of the charcoal card, with a faint red area beneath and a spark
 * at the leading edge. Ties the card to the "trend, not the scale" idea.
 */
export function TrendMotif() {
  return (
    <Motif>
      {/* Area under the curve — dark red, so white ink over it only gains contrast. */}
      <Path
        d="M0 78 C22 70 34 58 50 60 C66 62 78 46 100 40 L100 100 L0 100 Z"
        fill={colors.accentFaint}
        opacity={0.55}
      />
      {/* The trend line itself. */}
      <Path
        d="M0 78 C22 70 34 58 50 60 C66 62 78 46 100 40"
        fill="none"
        stroke={colors.accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.32}
      />
      <Circle cx={100} cy={40} r={2.4} fill={colors.accent} opacity={0.5} />
    </Motif>
  );
}
