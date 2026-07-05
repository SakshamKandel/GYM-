import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import type { BadgeIconKey } from '@gym/shared';

/**
 * The ~12 flat badge glyphs, one react-native-svg component per
 * `BadgeIconKey`. Flat, red/charcoal, no gradients or glow — matches the
 * app's icon language (see Ring.tsx, StreakFlame.tsx). Every glyph draws in a
 * 24×24 viewBox scaled to `size`, stroke-based so `color` recolors the whole
 * mark for the locked/earned states without needing separate art.
 *
 * `check` is the small verified-overlay glyph (drawn inside a filled circle),
 * composited by BadgeTile — not a standalone badge icon.
 */

export interface GlyphProps {
  size?: number;
  color: string;
}

const COMMON = { fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function Barbell({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="6" y1="12" x2="18" y2="12" stroke={color} {...COMMON} />
      <Rect x="3" y="9" width="2.4" height="6" rx="0.8" fill={color} />
      <Rect x="18.6" y="9" width="2.4" height="6" rx="0.8" fill={color} />
      <Rect x="5.4" y="7" width="2" height="10" rx="0.8" fill={color} />
      <Rect x="16.6" y="7" width="2" height="10" rx="0.8" fill={color} />
    </Svg>
  );
}

function Trophy({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M8 4h8v4a4 4 0 0 1-8 0V4z"
        stroke={color}
        {...COMMON}
      />
      <Path d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5c0 1.8 1.4 3.3 3.2 3.5" stroke={color} {...COMMON} />
      <Path d="M16 5h2.5A1.5 1.5 0 0 1 20 6.5c0 1.8-1.4 3.3-3.2 3.5" stroke={color} {...COMMON} />
      <Line x1="12" y1="12" x2="12" y2="16" stroke={color} {...COMMON} />
      <Path d="M8.5 19.5h7" stroke={color} {...COMMON} />
      <Path d="M9.5 16h5l1 3.5h-7z" stroke={color} {...COMMON} />
    </Svg>
  );
}

function Flame({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3c1 2.4-.6 3.7-1.6 4.9C9 9.3 8 10.8 8 13a4 4 0 0 0 8 0c0-1.2-.5-2-1-2.7.6.3 2 1.4 2 3.9a5 5 0 0 1-10 0c0-3.6 2-5 3-6.6C10.6 6.4 11 4.6 12 3z"
        stroke={color}
        {...COMMON}
      />
    </Svg>
  );
}

function SessionStack({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="15" width="16" height="3.4" rx="1" stroke={color} {...COMMON} />
      <Rect x="5.5" y="10.3" width="13" height="3.4" rx="1" stroke={color} {...COMMON} />
      <Rect x="7" y="5.6" width="10" height="3.4" rx="1" stroke={color} {...COMMON} />
    </Svg>
  );
}

function TonnageBars({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4.5" y="13" width="3" height="6.5" rx="0.6" stroke={color} {...COMMON} />
      <Rect x="10.5" y="9" width="3" height="10.5" rx="0.6" stroke={color} {...COMMON} />
      <Rect x="16.5" y="5" width="3" height="14.5" rx="0.6" stroke={color} {...COMMON} />
    </Svg>
  );
}

function Star({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3.5l2.4 5 5.5.6-4 3.8.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.8 5.5-.6z"
        stroke={color}
        {...COMMON}
      />
    </Svg>
  );
}

function Clipboard({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="5.5" y="4.5" width="13" height="16" rx="2" stroke={color} {...COMMON} />
      <Rect x="9" y="3" width="6" height="3" rx="1" stroke={color} {...COMMON} />
      <Path d="M8.5 12.5l2.2 2.2 4.3-4.6" stroke={color} {...COMMON} />
    </Svg>
  );
}

function Buddies({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="8.5" cy="8.5" r="2.6" stroke={color} {...COMMON} />
      <Circle cx="16" cy="9.5" r="2.1" stroke={color} {...COMMON} />
      <Path d="M4 18.5c0-2.9 2-4.9 4.5-4.9s4.5 2 4.5 4.9" stroke={color} {...COMMON} />
      <Path d="M13.3 14.2c1.9.3 3.2 2 3.2 4.3" stroke={color} {...COMMON} />
    </Svg>
  );
}

function Award({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="9" r="5" stroke={color} {...COMMON} />
      <Path d="M9 13.3L7.5 20l4.5-2.4 4.5 2.4-1.5-6.7" stroke={color} {...COMMON} />
    </Svg>
  );
}

function Comeback({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12a7 7 0 1 0 2.1-5" stroke={color} {...COMMON} />
      <Path d="M7.5 3.5v3.5H4" stroke={color} {...COMMON} />
    </Svg>
  );
}

function Shield({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3.5l6.5 2.4v5c0 4.4-2.7 7.7-6.5 9.1-3.8-1.4-6.5-4.7-6.5-9.1v-5z"
        stroke={color}
        {...COMMON}
      />
    </Svg>
  );
}

/** Small check overlay — composited on top of a badge glyph for verified. */
function Check({ size = 24, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 12.5l4 4 8-9" stroke={color} {...COMMON} strokeWidth={2.4} />
    </Svg>
  );
}

const GLYPHS: Record<BadgeIconKey, (props: GlyphProps) => React.JSX.Element> = {
  barbell: Barbell,
  trophy: Trophy,
  flame: Flame,
  sessions: SessionStack,
  tonnage: TonnageBars,
  star: Star,
  clipboard: Clipboard,
  buddies: Buddies,
  award: Award,
  comeback: Comeback,
  shield: Shield,
  check: Check,
};

/** Look up the glyph component for a catalog icon key. */
export function BadgeGlyph({ icon, size, color }: { icon: BadgeIconKey } & GlyphProps) {
  const Glyph = GLYPHS[icon];
  return <Glyph size={size} color={color} />;
}

export { Check as VerifiedCheckGlyph };
