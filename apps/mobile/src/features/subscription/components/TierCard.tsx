import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import { compareTiers, formatMoney, type Tier } from '@gym/shared';
import { cardMetals, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, Button, PressableScale, Tag, enterUp } from '../../../components/ui';
import type { SubscriptionCatalog, TrialTier } from '../../../lib/api/client';
import { GM_TIERS, RECOMMENDED_TIER, tierPriceDisplay, type GmTier } from '../logic';
import { TRIAL_TIERS } from '../trial';

/**
 * Paywall tier card — the premium membership-card face (v2, replaces the flat
 * charcoal/red-block card). Each tier is rendered as its own brushed-metal
 * membership card using the sanctioned `cardMetals` palettes from ui-tokens
 * (the same material language as the Settings MembershipCard): graphite
 * Starter, sterling Silver, 24k Gold, noir Elite. All ink comes from the
 * metal palette (documented ≥4.5:1 on the mid-gradient stop), so there are
 * no inline colors and contrast holds on every face.
 *
 * The art is STATIC (design law): a diagonal metal gradient, fine brushed
 * hairlines, one soft glint, a barely-there plate watermark and a machined
 * inner frame — measured at layout time so the watermark stays a perfect
 * circle at any card height. The recommended tier keeps the screen's ONE red
 * primary CTA (black-on-red brand law); every other card carries a quiet
 * near-black pill.
 *
 * Behavior is identical to the old card: choose / trial / current state /
 * discount tag / "see everything included" sheet link.
 */

interface TierCardProps {
  gmTier: GmTier;
  index: number;
  currentTier: Tier;
  catalog: SubscriptionCatalog | null;
  onChoose: (tier: Tier) => void;
  trialDays: number;
  trialed: boolean;
  isTrialActive: boolean;
  trialing: string | null;
  onTrial: (tier: TrialTier) => Promise<void>;
  onOpenDetail: (tier: GmTier) => void;
  signedIn: boolean;
}

type Metal = (typeof cardMetals)[Tier];

/** Static brushed-metal face — same recipe as the Settings MembershipCard,
 * sized from onLayout so it fits any card height without distorting. */
function MetalFace({ metal, tier, width, height }: { metal: Metal; tier: Tier; width: number; height: number }) {
  const gradientId = `tierMetal-${tier}`;
  const glintId = `tierGlint-${tier}`;
  // Brushed hairlines: precomputed static rows, identical every render.
  const hairlines: number[] = [];
  for (let y = 6; y < height - 4; y += 4) hairlines.push(y);
  // Plate watermark parked off the right edge, vertically centered.
  const cx = width - 18;
  const cy = height * 0.44;
  const r = Math.min(width * 0.27, 92);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor={metal.top} />
          <Stop offset="0.5" stopColor={metal.mid} />
          <Stop offset="1" stopColor={metal.deep} />
        </LinearGradient>
        <LinearGradient id={glintId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={metal.sheen} stopOpacity="0" />
          <Stop offset="0.35" stopColor={metal.sheen} stopOpacity="0.14" />
          <Stop offset="0.5" stopColor={metal.sheen} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${gradientId})`} />
      {hairlines.map((y, i) => (
        <Line
          key={y}
          x1={-4}
          y1={y}
          x2={width + 4}
          y2={y}
          stroke={i % 2 === 0 ? metal.sheen : metal.deep}
          strokeWidth={0.5}
          opacity={i % 2 === 0 ? 0.05 : 0.07}
        />
      ))}
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${glintId})`} />
      <Circle cx={cx} cy={cy} r={r} stroke={metal.sheen} strokeWidth={12} fill="none" opacity={0.045} />
      <Circle cx={cx} cy={cy} r={r * 0.6} stroke={metal.sheen} strokeWidth={8} fill="none" opacity={0.05} />
      <Circle cx={cx} cy={cy} r={r * 0.23} stroke={metal.sheen} strokeWidth={5} fill="none" opacity={0.055} />
      {/* Machined inner edge. */}
      <Rect
        x={1.25}
        y={1.25}
        width={Math.max(0, width - 2.5)}
        height={Math.max(0, height - 2.5)}
        rx={radius.block - 6}
        fill="none"
        stroke={metal.sheen}
        strokeWidth={0.8}
        opacity={0.22}
      />
    </Svg>
  );
}

/** Tier-initial monogram in a thin ring — the card's "network logo" mark. */
function Monogram({ metal, letter }: { metal: Metal; letter: string }) {
  return (
    <View style={[styles.monogram, { borderColor: metal.sheen }]}>
      <AppText style={[styles.monogramLetter, { color: metal.ink }]} tabular={false}>
        {letter}
      </AppText>
    </View>
  );
}

/** Text-only trial affordance — mirrors `Button variant="ghost"` metrics
 * (a11y, loading/disabled states) but with metal ink for the card face. */
function MetalGhostButton({
  label,
  ink,
  disabled,
  loading,
  onPress,
}: {
  label: string;
  ink: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.ghost, (disabled || loading) && styles.ghostDisabled]}
    >
      {loading ? <ActivityIndicator color={ink} /> : null}
      <AppText
        style={[styles.ghostLabel, { color: ink }]}
        tabular={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}

export function TierCard({
  gmTier,
  index,
  currentTier,
  catalog,
  onChoose,
  trialDays,
  trialed,
  isTrialActive,
  trialing,
  onTrial,
  onOpenDetail,
  signedIn,
}: TierCardProps) {
  const metal = cardMetals[gmTier.tier];
  const isCurrent = gmTier.tier === currentTier;
  const isRecommended = gmTier.tier === RECOMMENDED_TIER;
  const price = tierPriceDisplay(gmTier.tier, catalog);
  const previous = index > 0 ? GM_TIERS[index - 1] : undefined;
  const canTrial = TRIAL_TIERS.includes(gmTier.tier as TrialTier);
  // Dark faces (graphite, noir) need a hairline on the near-black pill so the
  // CTA separates from the card; pills may carry strokes (chips/tags do).
  const darkFace = gmTier.tier === 'starter' || gmTier.tier === 'elite';

  const [art, setArt] = useState<{ w: number; h: number } | null>(null);
  function onLayout(e: LayoutChangeEvent): void {
    const { width, height } = e.nativeEvent.layout;
    setArt({ w: width, h: height });
  }

  const trialLabel = isTrialActive
    ? 'Trial active'
    : trialed
      ? 'Trial used'
      : `Try free for ${trialDays} days`;

  const discountLabel =
    price.discountPct !== null
      ? price.discountSource === 'referral'
        ? `Referral −${price.discountPct}%`
        : `Promo −${price.discountPct}%`
      : null;

  return (
    <Animated.View entering={enterUp(index + 1)} style={styles.card} onLayout={onLayout}>
      <View style={styles.artClip} pointerEvents="none" accessible={false}>
        {art ? <MetalFace metal={metal} tier={gmTier.tier} width={art.w} height={art.h} /> : null}
      </View>

      {/* Brand row — the card issuer line + status tags. */}
      <View style={styles.brandRow}>
        <AppText style={[styles.brand, { color: metal.inkDim }]} tabular={false}>
          GM METHOD
        </AppText>
        <View style={styles.tags}>
          {isRecommended ? <Tag label="Most popular" variant="filled" /> : null}
          {isCurrent ? <Tag label="Current" variant="outline" color={metal.inkDim} /> : null}
        </View>
      </View>

      {/* Engraved tier wordmark + the membership card's single red accent. */}
      <AppText
        style={[
          styles.wordmark,
          {
            color: metal.ink,
            textShadowColor: metal.deep,
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 1,
          },
        ]}
        tabular={false}
        numberOfLines={1}
      >
        {gmTier.name}
      </AppText>
      <View style={[styles.accentLine, { backgroundColor: metal.stripe }]} />

      <View style={styles.priceRow}>
        <View style={styles.priceLeft}>
          {price.isFree ? (
            <AppText style={[styles.priceNumber, { color: metal.ink }]} numberOfLines={1}>
              Free
            </AppText>
          ) : (
            <>
              {price.discountedMinor !== null ? (
                <AppText
                  variant="caption"
                  color={metal.inkDim}
                  style={styles.strike}
                  numberOfLines={1}
                >
                  {formatMoney(price.baseMinor, price.currency)}
                </AppText>
              ) : null}
              <View style={styles.priceLine}>
                <AppText
                  style={[styles.priceNumber, { color: metal.ink }]}
                  tabular
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {formatMoney(price.discountedMinor ?? price.baseMinor, price.currency)}
                </AppText>
                <AppText variant="caption" color={metal.inkDim}>
                  /mo
                </AppText>
              </View>
            </>
          )}
          {discountLabel ? (
            <View style={styles.discountTagRow}>
              <Tag label={discountLabel} variant="outline" color={metal.inkDim} />
            </View>
          ) : null}
        </View>
        <Monogram metal={metal} letter={gmTier.name.charAt(0)} />
      </View>

      <AppText variant="caption" color={metal.inkDim} style={styles.tagline}>
        {gmTier.tagline}
      </AppText>

      <View style={styles.features}>
        {previous ? (
          <AppText variant="caption" color={metal.inkDim}>
            Everything in {previous.name}, plus
          </AppText>
        ) : null}
        {gmTier.features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={metal.ink}
              style={styles.featureIcon}
            />
            <AppText color={metal.ink} style={styles.featureText}>
              {feature}
            </AppText>
          </View>
        ))}
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`See everything included in ${gmTier.name}`}
        onPress={() => onOpenDetail(gmTier)}
        style={styles.detailLink}
      >
        <AppText variant="caption" color={metal.inkDim}>
          See everything included
        </AppText>
        <Ionicons name="chevron-forward" size={16} color={metal.inkDim} />
      </PressableScale>

      {isCurrent ? null : (
        <View style={styles.btnStack}>
          <Button
            label={`Choose ${gmTier.name}`}
            variant={isRecommended ? 'primary' : 'onBlock'}
            onPress={() => onChoose(gmTier.tier)}
            style={darkFace && !isRecommended ? [styles.darkCta, { borderColor: metal.sheen }] : undefined}
          />
          {/* Trials only make sense on tiers ABOVE the current one — the
              server refuses the rest with 'not_an_upgrade'. */}
          {canTrial && signedIn && compareTiers(gmTier.tier, currentTier) > 0 ? (
            <MetalGhostButton
              label={trialLabel}
              ink={metal.ink}
              disabled={trialed || trialing !== null}
              loading={trialing === gmTier.tier}
              onPress={() => onTrial(gmTier.tier as TrialTier)}
            />
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  artClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  brand: {
    fontFamily: type.display,
    fontSize: 13,
    letterSpacing: 4,
  },
  tags: { flexShrink: 0, flexDirection: 'row', gap: spacing.sm },

  wordmark: {
    fontFamily: type.display,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
  },
  accentLine: {
    width: 34,
    height: 2,
    borderRadius: 1,
    marginTop: spacing.sm,
  },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  priceLeft: { flexShrink: 1, minWidth: 0, gap: 2 },
  priceLine: {
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
    flexShrink: 1,
    minWidth: 0,
  },
  strike: { textDecorationLine: 'line-through' },
  discountTagRow: { flexDirection: 'row', marginTop: spacing.xs },

  monogram: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  monogramLetter: {
    fontFamily: type.display,
    fontSize: 20,
    letterSpacing: 0.5,
  },

  tagline: { marginTop: spacing.xs },

  features: { marginTop: spacing.lg, gap: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  featureIcon: { marginTop: 3 },
  featureText: { flex: 1, lineHeight: 24 },

  detailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.min,
    marginTop: spacing.sm,
  },

  btnStack: { marginTop: spacing.sm, gap: spacing.xs },
  darkCta: { borderWidth: 1 },

  ghost: {
    minHeight: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ghostDisabled: { opacity: 0.4 },
  ghostLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    letterSpacing: 0.3,
  },
});
