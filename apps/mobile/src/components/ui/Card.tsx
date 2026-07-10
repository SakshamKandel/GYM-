import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius as radiusTokens, spacing } from '@gym/ui-tokens';
import { PressableScale } from './PressableScale';

/**
 * Color-block card (REVAMP-BRIEF §1/§3): chunky `radius.block` corners, flat
 * fill, NO border — separation comes from fill contrast, never strokes.
 *
 * Variants (text-color context for children):
 * - `charcoal` (default) — `colors.surface` fill; children use `colors.text`
 *   / `colors.textDim` as usual.
 * - `red` — the screen's ONE hero block (`colors.blockRed`). Children MUST
 *   use `colors.onBlock` (black) for text/icons — never white-on-red.
 * - `cream` — counterpoint block (`colors.blockCream`, at most one per
 *   screen). Children use `colors.onBlock`; secondary text `colors.creamDim`.
 *
 * Pass `onPress` to make the whole card tappable (springy PressableScale —
 * never an opacity-only press).
 */

type CardVariant = 'charcoal' | 'red' | 'cream';

interface Props {
  children: ReactNode;
  /** Block color — sets the fill and the expected ink for children. */
  variant?: CardVariant;
  /** Makes the whole card a tap target (PressableScale spring). */
  onPress?: () => void;
  /** Inner padding — defaults to spacing.gutter (brief §3: card inner padding). */
  padding?: number;
  /** Corner radius — defaults to radius.block (26). */
  radius?: number;
  /** Card fill — overrides the variant fill when set. */
  backgroundColor?: string;
  /** @deprecated Cards have no borders in the block language — ignored. */
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
  /** Describe the tap action when `onPress` is set. */
  accessibilityLabel?: string;
}

const VARIANT_BG: Record<CardVariant, string> = {
  charcoal: colors.surface,
  red: colors.blockRed,
  cream: colors.blockCream,
};

export function Card({
  children,
  variant = 'charcoal',
  onPress,
  padding,
  radius = radiusTokens.block,
  backgroundColor,
  style,
  accessibilityLabel,
}: Props) {
  const cardStyle: StyleProp<ViewStyle> = [
    {
      padding: padding ?? spacing.gutter,
      borderRadius: radius,
      backgroundColor: backgroundColor ?? VARIANT_BG[variant],
    },
    style,
  ];

  if (onPress) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={cardStyle}
      >
        {children}
      </PressableScale>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}
