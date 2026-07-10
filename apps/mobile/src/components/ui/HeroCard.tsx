import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@gym/ui-tokens';

/**
 * Color-block hero card (revamp): a flat sticker-like block — chunky
 * `radius.block` corners, no border, no gradient. `variant` picks the fill:
 * 'red' (the ONE energetic hero per screen — black text on top), 'cream'
 * (the counterpoint block, at most one per screen) or 'charcoal'. The brand
 * mascot can still bleed in from the right edge inside any block.
 */
interface Props {
  children: ReactNode;
  /** Show the mascot character art on the right edge. */
  mascot?: boolean;
  /** Block fill — exactly one 'red' hero per screen (default). */
  variant?: 'red' | 'cream' | 'charcoal';
  /** Legacy alias kept for older call sites: 'surface' → charcoal. */
  tone?: 'surface' | 'red';
  style?: StyleProp<ViewStyle>;
}

const FILLS = {
  red: colors.blockRed,
  cream: colors.blockCream,
  charcoal: colors.surface,
} as const;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.block,
    overflow: 'hidden',
  },
  inner: { padding: spacing.gutter, gap: spacing.md },
  mascot: {
    position: 'absolute',
    right: -28,
    bottom: -14,
    width: 168,
    height: 168,
    opacity: 0.9,
  },
  /** Keeps text readable where the art sits. */
  contentWithMascot: { paddingRight: 120 },
});

export function HeroCard({ children, mascot = false, variant, tone, style }: Props) {
  // `tone` is the pre-revamp prop; map it so every existing call site keeps
  // compiling and rendering sensibly until screens migrate to `variant`.
  const resolved: 'red' | 'cream' | 'charcoal' =
    variant ?? (tone === 'surface' ? 'charcoal' : 'red');
  return (
    <View style={[styles.card, { backgroundColor: FILLS[resolved] }, style]}>
      {mascot ? (
        <Image
          source={require('../../../assets/images/mascot.png')}
          style={styles.mascot}
          contentFit="contain"
          accessibilityElementsHidden
        />
      ) : null}
      <View style={[styles.inner, mascot && styles.contentWithMascot]}>{children}</View>
    </View>
  );
}
