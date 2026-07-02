import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@gym/ui-tokens';

/**
 * Premium hero block: subtle vertical charcoal gradient (solid color blocking,
 * no blur/glow), hairline border, big radius — optionally with the brand
 * mascot art bleeding in from the right like the reference's athlete photo.
 */
interface Props {
  children: ReactNode;
  /** Show the mascot character art on the right edge. */
  mascot?: boolean;
  /** 'red' turns the card into a solid accent block (one per screen max). */
  tone?: 'surface' | 'red';
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  redCard: { borderColor: colors.accentDim },
  inner: { padding: spacing.xl, gap: spacing.md },
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

const SURFACE_RAMP = [colors.surfaceRaised, colors.surface] as const;
const RED_RAMP = [colors.accent, colors.accentDim] as const;

export function HeroCard({ children, mascot = false, tone = 'surface', style }: Props) {
  return (
    <View style={[styles.card, tone === 'red' && styles.redCard, style]}>
      <LinearGradient
        colors={tone === 'red' ? [...RED_RAMP] : [...SURFACE_RAMP]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      >
        {mascot ? (
          <Image
            source={require('../../../assets/images/mascot.png')}
            style={styles.mascot}
            contentFit="contain"
            accessibilityElementsHidden
          />
        ) : null}
        <View style={[styles.inner, mascot && styles.contentWithMascot]}>{children}</View>
      </LinearGradient>
    </View>
  );
}
