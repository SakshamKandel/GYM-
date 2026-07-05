import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { GM_TIERS, restShieldQuota, type Tier } from '@gym/shared';
import { radius, spacing, type } from '@gym/ui-tokens';
import { AppText, Button } from '../../../components/ui';
import {
  BADGE_STOP_OFFSETS,
  TIER_PALETTE,
  VIP_CARD,
  type MetallicTier,
} from '../../../components/ui/tierPalette';

/**
 * VIP membership card — the profile area's luxury island. A dark per-tier
 * card (graphite/silver, black-gold, red-black lacquer) with STATIC art
 * only: a soft vertical sheen, 2–3 faint diagonal light streaks and a few
 * tiny sparkle glyphs biased to the upper right, all clipped inside the
 * metallic border. The only animation on this surface is the caller-passed
 * avatar ring (AnimatedTierRing); the card itself never moves.
 *
 * Starter renders the same frame in plain charcoal with ZERO VIP art — it is
 * the sales surface: one pitch line and the Upgrade button as the single
 * accent.
 */

export interface VipCardProps {
  /** Server-authoritative tier (useAuth user.tier — never useProfile.tier). */
  tier: Tier;
  /** The avatar, already wrapped in AnimatedTierRing by the caller. */
  avatar: ReactNode;
  /** The caller's editable-name block (no shield — the pill carries tier). */
  nameSlot: ReactNode;
  /** email | 'Local only — sign in to sync' */
  subtitle: string;
  /** Routes to the subscribe screen. Button hidden when tier === 'elite'. */
  onUpgrade: () => void;
}

const PILL_LABEL: Record<MetallicTier, string> = {
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE',
};

/** Streak slope — ~35° from horizontal, rising to the right (top-lit law). */
const STREAK_RUN_PER_RISE = 1.428; // 1 / tan(35°)

/** Diagonal streaks: bottom-edge anchor (fraction of width), stroke, opacity. */
const STREAKS = [
  { anchor: 0.28, width: 26, opacity: 0.07 },
  { anchor: 0.52, width: 34, opacity: 0.05 },
  { anchor: 0.74, width: 22, opacity: 0.08 },
] as const;

/**
 * Tiny 4-point sparkle diamonds — static, clustered upper-right where the
 * streaks exit, one drifting low for balance. `scale` is applied to an 8px
 * base glyph (0.5 → 4px … 0.85 → 6.8px).
 */
const SPARKLES = [
  { x: 0.68, y: 0.18, scale: 0.85, opacity: 0.7 },
  { x: 0.8, y: 0.34, scale: 0.55, opacity: 0.55 },
  { x: 0.9, y: 0.14, scale: 0.7, opacity: 0.8 },
  { x: 0.58, y: 0.42, scale: 0.5, opacity: 0.5 },
  { x: 0.16, y: 0.78, scale: 0.6, opacity: 0.55 },
] as const;

const SPARKLE_PATH = 'M0 -4 L1.4 0 L0 4 L-1.4 0 Z';

/** The card's static background art — sheen, streaks, sparkles. */
function CardArt({ tier, width, height }: { tier: Tier; width: number; height: number }) {
  const palette = VIP_CARD[tier];
  const glam = tier !== 'starter';
  // Streaks overshoot both edges so their rounded caps never show.
  const rise = height + 48;
  const run = rise * STREAK_RUN_PER_RISE;
  const gradientId = `vipBase-${tier}`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={palette.baseSheen} />
          <Stop offset="100%" stopColor={palette.base} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${gradientId})`} />
      {glam
        ? STREAKS.map((s, i) => {
            const x1 = s.anchor * width;
            return (
              <Line
                key={i}
                x1={x1}
                y1={height + 24}
                x2={x1 + run}
                y2={-24}
                stroke={palette.streak}
                strokeWidth={s.width}
                strokeOpacity={s.opacity}
              />
            );
          })
        : null}
      {glam
        ? SPARKLES.map((sp, i) => (
            <Path
              key={i}
              d={SPARKLE_PATH}
              fill={palette.sparkle}
              fillOpacity={sp.opacity}
              transform={`translate(${sp.x * width}, ${sp.y * height}) scale(${sp.scale})`}
            />
          ))
        : null}
    </Svg>
  );
}

/** Metallic tier pill — the shield's finish in a quiet capsule (no shield). */
function TierPill({ tier }: { tier: MetallicTier }) {
  const palette = TIER_PALETTE[tier];
  const gradientId = `vipPill-${tier}`;
  return (
    <View style={[styles.pill, { borderColor: palette.border }]}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {palette.stops.map((color, i) => (
              <Stop key={BADGE_STOP_OFFSETS[i]} offset={BADGE_STOP_OFFSETS[i]} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
      <AppText style={[styles.pillText, { color: palette.glyph }]} tabular={false}>
        {PILL_LABEL[tier]}
      </AppText>
    </View>
  );
}

export function VipCard({ tier, avatar, nameSlot, subtitle, onUpgrade }: VipCardProps) {
  const [art, setArt] = useState<{ w: number; h: number } | null>(null);
  const palette = VIP_CARD[tier];

  function onLayout(e: LayoutChangeEvent): void {
    const { width, height } = e.nativeEvent.layout;
    // Art paints the padding box (inside the 1.5px border on each side).
    setArt({ w: Math.max(0, width - 3), h: Math.max(0, height - 3) });
  }

  // 2–3 real perk lines from the tier catalog + the Rest Shield entitlement.
  const catalogPerks = GM_TIERS.find((t) => t.tier === tier)?.features.slice(0, 2) ?? [];
  const shieldQuota = restShieldQuota(tier);
  const perks =
    shieldQuota > 0
      ? [...catalogPerks, `${shieldQuota} Rest Shield${shieldQuota > 1 ? 's' : ''} / month`]
      : catalogPerks;

  return (
    <View
      onLayout={onLayout}
      style={[styles.card, { borderColor: palette.border, backgroundColor: palette.base }]}
    >
      <View style={styles.artClip} pointerEvents="none">
        {art ? <CardArt tier={tier} width={art.w} height={art.h} /> : null}
      </View>
      {tier === 'elite' ? <View style={styles.eliteHairline} pointerEvents="none" /> : null}

      <View style={styles.headerRow}>
        {avatar}
        <View style={styles.headerInfo}>
          {nameSlot}
          <AppText variant="caption" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
      </View>

      {tier !== 'starter' ? (
        <View style={styles.pillRow}>
          <TierPill tier={tier} />
        </View>
      ) : null}

      {tier === 'starter' ? (
        <AppText variant="caption" style={styles.pitch}>
          Go Gold — Rest Shields, signature plans, adaptive progression.
        </AppText>
      ) : (
        <View style={styles.perks}>
          {perks.map((perk) => (
            <View key={perk} style={styles.perkRow}>
              <Ionicons name="checkmark" size={14} color={palette.sparkle} />
              <AppText variant="caption" numberOfLines={2} style={styles.perkText}>
                {perk}
              </AppText>
            </View>
          ))}
        </View>
      )}

      {tier !== 'elite' ? (
        <Button
          label="Upgrade"
          variant={tier === 'starter' ? 'primary' : 'secondary'}
          onPress={onUpgrade}
          accessibilityLabel="Upgrade your plan"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.lg,
    gap: spacing.md,
  },
  // Clips the art to the padding box so streaks never bleed over the border.
  artClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Math.max(0, radius.lg - 1.5),
    overflow: 'hidden',
  },
  // Elite's second, inset gold hairline — the lacquer-box detail.
  eliteHairline: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderWidth: 1,
    borderColor: '#D9B25A',
    borderRadius: Math.max(0, radius.lg - 4),
    opacity: 0.35,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerInfo: { flex: 1, gap: 2, minWidth: 0 },
  pillRow: { flexDirection: 'row' },
  pill: {
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontFamily: type.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
  },
  perks: { gap: spacing.xs },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  perkText: { flex: 1, minWidth: 0 },
  pitch: { lineHeight: 18 },
});
