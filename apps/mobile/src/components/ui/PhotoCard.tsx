import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageProps } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { PressableScale } from './PressableScale';

/**
 * Photo block (revamp): an expo-image cover photo framed inside a
 * `radius.block` container with a bottom-anchored dark scrim so overlay text
 * stays legible on any photo (the one approved gradient use — not decorative
 * blur/glow). No border — fill contrast separates the block.
 *
 * `inset` pads the card like a block interior, so the photo becomes a
 * `radius.md` frame inside the block (brief §8) instead of filling it.
 * `children` render over the scrim, anchored to the bottom-left.
 */
interface Props {
  /** Usually a key from `stockImages`, e.g. `stockImages.heroBarbell`. */
  source: ImageProps['source'];
  /** Card height — defaults to 180. */
  height?: number;
  /** Frame the photo inside block-interior padding (radius.md inner frame). */
  inset?: boolean;
  /** Content rendered over the scrim (titles, tags, stats). */
  children?: ReactNode;
  /** Makes the whole card a tap target (PressableScale spring). */
  onPress?: () => void;
  /** Required — describe the photo (or the tap action when pressable). */
  accessibilityLabel: string;
  /**
   * Marks the photo purely decorative — the Image is hidden from the screen
   * reader (`accessible={false}`) so overlay text/controls carry the meaning.
   * Use when the surrounding content already names what the photo depicts.
   */
  decorative?: boolean;
  /**
   * Extra full-bleed darkening (0–1) laid over the whole photo, beneath the
   * bottom scrim. Guarantees white ink clears 4.5:1 even over the brightest
   * region of a photo; the bottom gradient still does most of the work.
   */
  fullOverlay?: number;
  /** Passed to expo-image so swapping the source recycles cleanly (no flash). */
  recyclingKey?: string;
  style?: StyleProp<ViewStyle>;
}

/** Transparent into near-black, bottom-anchored, for text legibility. */
const SCRIM = ['transparent', 'rgba(0,0,0,0.72)'] as const;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.block,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardInset: { padding: spacing.gutter },
  frame: {
    flex: 1,
    borderRadius: radius.block,
    overflow: 'hidden',
  },
  frameInset: { borderRadius: radius.md },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  fullOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
});

export function PhotoCard({
  source,
  height = 180,
  inset = false,
  children,
  onPress,
  accessibilityLabel,
  decorative = false,
  fullOverlay,
  recyclingKey,
  style,
}: Props) {
  const inner = (
    <View style={[styles.frame, inset && styles.frameInset]}>
      <Image
        source={source}
        style={styles.photo}
        contentFit="cover"
        transition={150}
        recyclingKey={recyclingKey}
        accessible={decorative ? false : !onPress}
        accessibilityLabel={decorative || onPress ? undefined : accessibilityLabel}
      />
      {fullOverlay !== undefined && fullOverlay > 0 ? (
        <View
          pointerEvents="none"
          style={[styles.fullOverlay, { backgroundColor: `rgba(0,0,0,${fullOverlay})` }]}
        />
      ) : null}
      <LinearGradient colors={[...SCRIM]} style={styles.scrim} />
      <View style={styles.content}>{children}</View>
    </View>
  );

  if (onPress) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={[styles.card, inset && styles.cardInset, { height }, style]}
      >
        {inner}
      </PressableScale>
    );
  }

  return (
    <View style={[styles.card, inset && styles.cardInset, { height }, style]}>{inner}</View>
  );
}
