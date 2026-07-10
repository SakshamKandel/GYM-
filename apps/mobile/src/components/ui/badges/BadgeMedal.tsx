import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { badgeTier, type BadgeDef } from '@gym/shared';
import { colors } from '@gym/ui-tokens';
import {
  EARNED_RED_RAMP,
  METAL_RAMP,
  METAL_STOP_OFFSETS,
  VERIFIED_GOLD,
  type MetalRamp,
} from './achievementMetals';
import { BadgeGlyph } from './glyphs';

/**
 * Achievement medal — the earned-progression silhouette that replaced the
 * flat square tile. Two shapes so a badge never reads as the paid-tier
 * shield: strength clubs are pointy-top faceted HEXAGON plates (tiered
 * bronze/silver/gold/elite metal via badgeTier), everything else is a round
 * MEDAL hanging on a chevron ribbon, finished in the brand-red enamel.
 *
 * Depth comes only from what the design law allows: a static top-lit 4-stop
 * gradient (same ramps as RankEmblem), a dark outer hairline, a light inner
 * rim, and a translucent face inset. No glow, no filters, no animation.
 *
 * States: locked = engraved charcoal silhouette (optionally with a small
 * progress bar fed by badgeProgress), logged = full metal/enamel, verified =
 * logged + gold laurel flanks (coach-verified strength clubs; the green check
 * chip overlay stays with BadgeTile).
 */

export type BadgeMedalStatus = 'locked' | 'logged' | 'verified';

interface Props {
  badge: BadgeDef;
  status: BadgeMedalStatus;
  /** Rendered box is size × size; the silhouette fills it. */
  size?: number;
  /** 0..1 toward the threshold — small bar inside LOCKED medals. Null hides it. */
  progress?: number | null;
}

// All geometry lives in a 100×100 viewBox and scales with `size`.
const VB = 100;

interface Pt {
  x: number;
  y: number;
}

/** Regular pointy-top hexagon vertices around (cx, cy). */
function hexPoints(cx: number, cy: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

/** Closed path through `points` with quadratic-rounded corners. */
function roundedPolygonPath(points: Pt[], cornerR: number): string {
  const n = points.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n]!;
    const v = points[i]!;
    const next = points[(i + 1) % n]!;
    const inLen = Math.hypot(v.x - prev.x, v.y - prev.y);
    const outLen = Math.hypot(next.x - v.x, next.y - v.y);
    // Interior angle of a regular hexagon is 120°: cut = r / tan(60°).
    const cut = Math.min(cornerR / Math.tan(Math.PI / 3), inLen / 2, outLen / 2);
    const entry = {
      x: v.x + ((prev.x - v.x) / inLen) * cut,
      y: v.y + ((prev.y - v.y) / inLen) * cut,
    };
    const exit = {
      x: v.x + ((next.x - v.x) / outLen) * cut,
      y: v.y + ((next.y - v.y) / outLen) * cut,
    };
    parts.push(i === 0 ? `M ${entry.x} ${entry.y}` : `L ${entry.x} ${entry.y}`);
    parts.push(`Q ${v.x} ${v.y} ${exit.x} ${exit.y}`);
  }
  return `${parts.join(' ')} Z`;
}

// Hexagon plate (strength): center (50,50), circumradius 47.
const HEX_CENTER = { x: 50, y: 50 };
const HEX_OUTER = roundedPolygonPath(hexPoints(HEX_CENTER.x, HEX_CENTER.y, 47), 7);
const HEX_FACE = roundedPolygonPath(hexPoints(HEX_CENTER.x, HEX_CENTER.y, 47 * 0.86), 6);

// Round medal (everything else): disc at (50,46) r39 over a chevron ribbon.
const DISC_CENTER = { x: 50, y: 46 };
const DISC_R = 39;
const DISC_FACE_R = DISC_R * 0.84;
const RIBBON = 'M 37 66 L 37 96 L 50 88.5 L 63 96 L 63 66 Z';

// Gold laurel flanking the lower half — verified (hexagon) medals only.
const LAUREL_LEFT = ['M 47 95 Q 28 90 20 71', 'M 36.5 91.5 L 32 97.5', 'M 27.5 85 L 21.8 89.2', 'M 22 76.5 L 15.6 78.4'];
const LAUREL_RIGHT = ['M 53 95 Q 72 90 80 71', 'M 63.5 91.5 L 68 97.5', 'M 72.5 85 L 78.2 89.2', 'M 78 76.5 L 84.4 78.4'];

// Locked-state progress bar, drawn inside the silhouette below the glyph.
const BAR_W = 34;
const BAR_H = 4.5;
const BAR_Y = 66;

export function BadgeMedal({ badge, status, size = 76, progress = null }: Props) {
  const isHex = badge.family === 'strength';
  const earned = status !== 'locked';
  const tier = badgeTier(badge);
  const ramp: MetalRamp = tier !== null ? METAL_RAMP[tier] : EARNED_RED_RAMP;
  const gradientId = `medal-${badge.id}`;
  // Explicit userSpaceOnUse + real viewBox coordinates, not the implicit
  // objectBoundingBox 0..1 shorthand — react-native-svg's NATIVE renderer
  // (Android/iOS) has been unreliable resolving fractional gradient
  // coordinates against a Circle's bounding box, rendering the fill as
  // fully transparent (leaving only the stroke, i.e. hollow rings) even
  // though the identical markup paints correctly on web. Real coordinates
  // sidestep that platform difference entirely.
  const gradientY1 = isHex ? HEX_CENTER.y - 47 : DISC_CENTER.y - DISC_R;
  const gradientY2 = isHex ? HEX_CENTER.y + 47 : DISC_CENTER.y + DISC_R;

  const showBar = !earned && progress !== null;
  const ratio = showBar ? Math.max(0, Math.min(1, progress)) : 0;

  // Glyph sits at the silhouette's visual center, nudged up when a bar shows.
  const glyphCy = (isHex ? HEX_CENTER.y : DISC_CENTER.y) - (showBar ? 4.5 : 0);
  const glyphSize = size * (isHex ? 0.4 : 0.36);
  const glyphTop = (glyphCy / VB) * size - glyphSize / 2;

  // Gold glyph reads as premium on every finish EXCEPT the gold metal itself —
  // gold-on-gold collapses to ~1.5:1 contrast at the glyph's resting position
  // (mid-ramp, further dimmed by the face inset). Only that one tier falls
  // back to the dark engraved fill.
  const glyphColor = !earned ? colors.textFaint : tier === 'gold' ? colors.bg : VERIFIED_GOLD;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} style={StyleSheet.absoluteFill}>
        {earned ? (
          <Defs>
            <LinearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1={HEX_CENTER.x}
              y1={gradientY1}
              x2={HEX_CENTER.x}
              y2={gradientY2}
            >
              {ramp.map((color, i) => (
                <Stop key={METAL_STOP_OFFSETS[i]} offset={METAL_STOP_OFFSETS[i]} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
        ) : null}

        {/* Ribbon behind the disc — the "hanging medal" read (round only). */}
        {!isHex ? (
          <Path
            d={RIBBON}
            fill={earned ? ramp[2] : colors.surface}
            stroke={earned ? ramp[3] : colors.border}
            strokeWidth={earned ? 1 : 1.5}
          />
        ) : null}

        {/* Base plate/disc. */}
        {isHex ? (
          <Path
            d={HEX_OUTER}
            fill={earned ? `url(#${gradientId})` : colors.surface}
            stroke={earned ? ramp[3] : colors.border}
            strokeWidth={earned ? 1 : 1.5}
          />
        ) : (
          <Circle
            cx={DISC_CENTER.x}
            cy={DISC_CENTER.y}
            r={DISC_R}
            fill={earned ? `url(#${gradientId})` : colors.surface}
            stroke={earned ? ramp[3] : colors.border}
            strokeWidth={earned ? 1 : 1.5}
          />
        )}

        {/* Face inset + top-lit inner rim — the engraved-coin depth. */}
        {earned ? (
          isHex ? (
            <>
              <Path d={HEX_FACE} fill="#000000" fillOpacity={0.1} />
              <Path d={HEX_FACE} fill="none" stroke={ramp[0]} strokeWidth={1} strokeOpacity={0.45} />
            </>
          ) : (
            <>
              <Circle cx={DISC_CENTER.x} cy={DISC_CENTER.y} r={DISC_FACE_R} fill="#000000" fillOpacity={0.1} />
              <Circle
                cx={DISC_CENTER.x}
                cy={DISC_CENTER.y}
                r={DISC_FACE_R}
                fill="none"
                stroke={ramp[0]}
                strokeWidth={1}
                strokeOpacity={0.45}
              />
            </>
          )
        ) : null}

        {/* Locked threshold badges: how close you are, right on the tile. */}
        {showBar ? (
          <>
            <Rect
              x={(VB - BAR_W) / 2}
              y={BAR_Y}
              width={BAR_W}
              height={BAR_H}
              rx={BAR_H / 2}
              fill={colors.borderStrong}
            />
            {ratio > 0 ? (
              <Rect
                x={(VB - BAR_W) / 2}
                y={BAR_Y}
                width={Math.max(BAR_H, BAR_W * ratio)}
                height={BAR_H}
                rx={BAR_H / 2}
                fill={colors.accent}
              />
            ) : null}
          </>
        ) : null}

        {/* Coach-verified: gold laurel flanking the plate. */}
        {status === 'verified'
          ? [...LAUREL_LEFT, ...LAUREL_RIGHT].map((d) => (
              <Path
                key={d}
                d={d}
                fill="none"
                stroke={VERIFIED_GOLD}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            ))
          : null}
      </Svg>

      <View style={[styles.glyph, { top: glyphTop, width: size, height: glyphSize }]} pointerEvents="none">
        <BadgeGlyph icon={badge.icon} size={glyphSize} color={glyphColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
