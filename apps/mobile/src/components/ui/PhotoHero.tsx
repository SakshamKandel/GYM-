import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ImageProps } from 'expo-image';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { PhotoCard } from './PhotoCard';
import { Tag } from './Tag';

/**
 * The reference photographic hero (from the Train tab), extracted so every
 * surface renders the SAME treatment: a dark, decorative stock photo under a
 * bottom-weighted scrim + a subtle full overlay, with a red chip → oversized
 * Oswald title → dim caption → one red pill CTA stacked over it. White ink over
 * the scrim clears 4.5:1 on dark-toned photos anywhere in the lower frame.
 *
 * One component, three heights: `hero` (full block CTA), `banner` (compact mood
 * strip), `strip` (thin decorative accent). The photo is always decorative — the
 * chip/title/caption/CTA carry the semantics for the screen reader.
 */

export type PhotoHeroSize = 'hero' | 'banner' | 'strip';

const HEIGHTS: Record<PhotoHeroSize, number> = {
  hero: 252,
  banner: 140,
  strip: 108,
};

/** Title variant per size — display shout for heroes, calmer for banners. */
const TITLE_VARIANT: Record<PhotoHeroSize, ComponentProps<typeof AppText>['variant']> = {
  hero: 'display',
  banner: 'title',
  strip: 'bodyBold',
};

/**
 * Subtle full-bleed darken over the whole photo (on top of PhotoCard's bottom
 * gradient). Kept gentle: dark-toned photos + the bottom scrim already carry
 * legibility — this only insures the brightest region of any frame.
 */
const FULL_OVERLAY = 0.22;

interface HeroChip {
  label: string;
  variant?: ComponentProps<typeof Tag>['variant'];
}

interface HeroCta {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'onBlock' | 'secondary';
  accessibilityLabel?: string;
}

interface Props {
  /** Usually a key from `stockImages` (dark-toned photos only). */
  source: ImageProps['source'];
  /** Height variant — defaults to `hero`. */
  size?: PhotoHeroSize;
  /** Explicit pixel height override (rare — prefer `size`). */
  height?: number;
  /** Red pill chip above the title (e.g. "UP NEXT"). Defaults to filled red. */
  chip?: HeroChip;
  title?: string;
  /** Uppercase the title. Defaults ON for the `hero` size. */
  uppercaseTitle?: boolean;
  titleLines?: number;
  caption?: string;
  captionTabular?: boolean;
  captionLines?: number;
  /** Full-width pill CTA at the bottom of the block. */
  cta?: HeroCta;
  /** Extra content between caption and CTA (rare). */
  children?: ReactNode;
  /** Scene description for the decorative photo (parity/debug only). */
  accessibilityLabel?: string;
  /** Stable key so swapping the photo recycles cleanly (no flash). */
  recyclingKey?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm },
  upper: { textTransform: 'uppercase' },
  /** Secondary line over the scrim: white ink, gently dimmed (stays ≥4.5:1). */
  caption: { opacity: 0.85 },
  cta: { marginTop: spacing.sm },
});

export function PhotoHero({
  source,
  size = 'hero',
  height,
  chip,
  title,
  uppercaseTitle,
  titleLines,
  caption,
  captionTabular,
  captionLines,
  cta,
  children,
  accessibilityLabel,
  recyclingKey,
  style,
}: Props) {
  const upper = uppercaseTitle ?? size === 'hero';
  const isHero = size === 'hero';
  return (
    <PhotoCard
      source={source}
      height={height ?? HEIGHTS[size]}
      decorative
      fullOverlay={FULL_OVERLAY}
      recyclingKey={recyclingKey}
      accessibilityLabel={accessibilityLabel ?? 'Decorative photo'}
      style={style}
    >
      <View style={styles.content}>
        {chip ? <Tag label={chip.label} variant={chip.variant ?? 'filled'} /> : null}
        {title ? (
          <AppText
            variant={TITLE_VARIANT[size]}
            color={colors.text}
            numberOfLines={titleLines ?? (isHero ? 1 : 2)}
            adjustsFontSizeToFit={isHero}
            minimumFontScale={isHero ? 0.7 : undefined}
            style={upper ? styles.upper : undefined}
          >
            {title}
          </AppText>
        ) : null}
        {caption ? (
          <AppText
            variant="caption"
            color={colors.text}
            tabular={captionTabular ?? false}
            numberOfLines={captionLines ?? (isHero ? 1 : 2)}
            style={styles.caption}
          >
            {caption}
          </AppText>
        ) : null}
        {children}
        {cta ? (
          <Button
            label={cta.label}
            variant={cta.variant ?? 'primary'}
            onPress={cta.onPress}
            accessibilityLabel={cta.accessibilityLabel}
            style={styles.cta}
          />
        ) : null}
      </View>
    </PhotoCard>
  );
}
