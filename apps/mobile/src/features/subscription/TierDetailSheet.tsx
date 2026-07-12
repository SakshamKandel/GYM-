import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatMoney, type Tier } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, SectionLabel, Sheet, Tag } from '../../components/ui';
import { GM_TIERS, type GmTier, type TierPriceDisplay } from './logic';

/**
 * Tap-to-reveal detail for a paywall tier. Where the card only lists what a
 * tier ADDS ("Everything in Silver, plus…"), this sheet resolves the FULL
 * cumulative "everything you get" checklist for the plan, alongside its price
 * and trial status. Purely informational — the card keeps the CTAs.
 *
 * `detail` is controlled: null closes the sheet. The last non-null payload is
 * retained so the content stays put through the exit animation.
 */

export interface TierDetail {
  gmTier: GmTier;
  isCurrent: boolean;
  isRecommended: boolean;
  /** Precomputed trial line (parent owns the buddy-trial coupling), or null. */
  trialLine: string | null;
  /** Precomputed price (parent owns the catalog fetch), so the sheet stays catalog-free. */
  price: TierPriceDisplay;
}

/** Cumulative feature set for a tier: every plan up to and including it, with
 * the "Everything in X" pointer lines dropped so the list reads as real perks. */
function resolveFeatures(tier: Tier): string[] {
  const idx = GM_TIERS.findIndex((t) => t.tier === tier);
  if (idx < 0) return [];
  return GM_TIERS.slice(0, idx + 1)
    .flatMap((t) => t.features)
    .filter((f) => !/^everything in/i.test(f));
}

export function TierDetailSheet({
  detail,
  onClose,
}: {
  detail: TierDetail | null;
  onClose: () => void;
}) {
  // Retain the last payload so the sheet's exit animation still has content to
  // render after `detail` flips to null. Computed during render (no empty frame).
  const lastRef = useRef<TierDetail | null>(detail);
  if (detail) lastRef.current = detail;
  const shown = detail ?? lastRef.current;

  return (
    <Sheet visible={detail !== null} onClose={onClose} title={shown?.gmTier.name}>
      {shown ? <Body detail={shown} /> : null}
    </Sheet>
  );
}

function Body({ detail }: { detail: TierDetail }) {
  const { gmTier, isCurrent, isRecommended, trialLine, price } = detail;
  const features = resolveFeatures(gmTier.tier);
  const discountLabel =
    price.discountPct !== null
      ? price.discountSource === 'referral'
        ? `Referral −${price.discountPct}%`
        : `Promo −${price.discountPct}%`
      : null;

  return (
    // Up to 15 cumulative feature rows can outgrow the sheet's 88% height cap
    // on small phones — scroll (no CTA here, so everything scrolls together).
    <ScrollView showsVerticalScrollIndicator={false}>
      {isRecommended || isCurrent || discountLabel ? (
        <View style={styles.tags}>
          {isRecommended ? <Tag label="Most popular" variant="filled" /> : null}
          {isCurrent ? <Tag label="Current" variant="dim" /> : null}
          {discountLabel ? <Tag label={discountLabel} variant="outline" color={colors.success} /> : null}
        </View>
      ) : null}

      <View style={styles.priceRow}>
        {price.isFree ? (
          <AppText style={styles.priceNumber} numberOfLines={1}>
            Free
          </AppText>
        ) : (
          <>
            {price.discountedMinor !== null ? (
              <AppText
                variant="caption"
                color={colors.textDim}
                style={styles.strike}
                numberOfLines={1}
              >
                {formatMoney(price.baseMinor, price.currency)}
              </AppText>
            ) : null}
            <AppText
              style={styles.priceNumber}
              tabular
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatMoney(price.discountedMinor ?? price.baseMinor, price.currency)}
            </AppText>
            <AppText variant="caption" color={colors.textDim}>
              /mo
            </AppText>
          </>
        )}
      </View>

      <AppText variant="body" color={colors.textDim} style={styles.tagline}>
        {gmTier.tagline}
      </AppText>

      {trialLine ? (
        <View style={styles.trialPill} accessible accessibilityLabel={trialLine}>
          <Ionicons name="time-outline" size={16} color={colors.textDim} />
          <AppText variant="caption" color={colors.textDim} style={styles.trialText}>
            {trialLine}
          </AppText>
        </View>
      ) : null}

      {/* No hairline here — SectionLabel's own top margin is the separation
          (block language: gaps, not strokes). */}
      <SectionLabel>Everything you get</SectionLabel>
      <View style={styles.features}>
        {features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={colors.accent}
              style={styles.featureIcon}
            />
            <AppText style={styles.featureText}>{feature}</AppText>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    minWidth: 0,
  },
  priceNumber: {
    fontFamily: type.display,
    fontSize: type.size.display,
    lineHeight: 46,
    letterSpacing: 0.5,
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  strike: { textDecorationLine: 'line-through' },
  tags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tagline: { marginTop: spacing.sm },
  trialPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    minHeight: 32,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  trialText: { flexShrink: 1 },
  features: { gap: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  featureIcon: { marginTop: 3 },
  featureText: { flex: 1, lineHeight: 24 },
});
