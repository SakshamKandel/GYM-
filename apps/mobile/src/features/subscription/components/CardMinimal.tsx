import { StyleSheet, Text, View } from 'react-native';
import { cardMetals, radius, spacing, type } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "TYPE PLATE" (the minimal face).
 *
 * The anti-ornament card: one dead-flat plane of the tier metal — no
 * gradient, no texture, no chip, no watermark, no SVG at all — and a purely
 * typographic composition. The holder's SURNAME is the artwork: a huge
 * Oswald caps slab that auto-fits its single line (then ellipsizes), so no
 * name can ever escape the card; any forenames whisper above it as a
 * tracked-out eyebrow. Exactly ONE accent element — a short signal-red bar
 * over the name. Everything else (issuer, tier, serial, status) is micro
 * type pinned to the corners, and only the name speaks at full ink; the
 * restraint IS the design. Colors come only from cardMetals (rule 7).
 *
 * ELITE hallmark: the near-black elite metal turns a flat plane into a void,
 * so the flagship — and only the flagship — earns one embellishment: a fine
 * double-hairline frame (engraver's thick-thin rule) in the warm gold inkDim,
 * inset inside the edge. It gives the noir plate a perimeter to read against
 * without touching the typographic brief; other tiers stay untouched.
 */

const CARD_RATIO = 1.586; // ISO/IEC 7810 ID-1

const TIER_TITLE: Record<Tier, string> = {
  starter: 'MEMBER',
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE',
};

interface Props {
  tier: Tier;
  holderName: string;
  memberId: string | null;
  signedIn: boolean;
  /**
   * Raw ISO `tierExpiresAt` for the current tier (Pack J). When set, the card's
   * status corner becomes a card-style VALID THRU MM/YY (or EXPIRED once past).
   * Omitted / null = no expiry → the classic ACTIVE / LOCAL status. Optional so
   * existing call sites keep compiling until they pass the field.
   */
  expiresAt?: string | null;
  onPress?: () => void;
}

/** MM/YY for the card's status corner. Empty string on an unparseable value. */
function shortMonthYear(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${mm}/${yy}`;
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: CARD_RATIO,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  face: {
    flex: 1,
    padding: spacing.gutter,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    letterSpacing: 4,
  },
  tierWord: {
    fontFamily: type.bodySemiBold,
    fontSize: 12,
    letterSpacing: 3,
  },
  /** The nameplate: the ONE accent bar, then the typographic stack. */
  heroBlock: {
    gap: spacing.md,
  },
  accentBar: {
    width: 32,
    height: 3,
    borderRadius: radius.full,
  },
  /** Forenames — a whispered tracked eyebrow above the surname slab. */
  eyebrow: {
    fontFamily: type.bodySemiBold,
    fontSize: 13,
    letterSpacing: 5,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  /** Surname slab — huge Oswald caps; auto-fits so it can never overflow. */
  hero: {
    fontFamily: type.display,
    fontSize: type.size.heroTitle,
    lineHeight: 54,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  meta: {
    fontFamily: type.display,
    fontSize: 14,
    letterSpacing: 3,
  },
  /**
   * Elite-only double-hairline gold frame. Both rules sit inside the 20px
   * type gutter (insets 8 / 11), so they never cross a glyph; radii are
   * derived from radius.lg so the rules stay concentric with the card edge.
   */
  eliteFrame: {
    position: 'absolute',
  },
  eliteFrameOuter: {
    top: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg - spacing.sm,
    opacity: 0.55,
  },
  eliteFrameInner: {
    top: spacing.sm + 3,
    left: spacing.sm + 3,
    right: spacing.sm + 3,
    bottom: spacing.sm + 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg - spacing.sm - 3,
    opacity: 0.4,
  },
});

export function MembershipCardMinimal({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
  const last4 = memberId ? memberId.replace(/-/g, '').slice(-4).toUpperCase() : '0000';
  const name = (holderName || 'Athlete').trim();
  // Typographic split: the LAST word becomes the huge slab, any preceding
  // words become the eyebrow. Single-word names simply drop the eyebrow.
  const words = name.split(/\s+/);
  const heroWord = words[words.length - 1] ?? name;
  const foreNames = words.slice(0, -1).join(' ');
  // Expiry corner (Pack J): only when a real window exists AND the tier is paid
  // (a free 'starter' card carries no VALID THRU).
  const expiry = expiresAt && tier !== 'starter' ? tierExpiryInfo(expiresAt) : null;
  const showExpiry = expiry !== null && expiry.dateLabel !== null;
  const expiryLabel = showExpiry
    ? expiry.expired
      ? `, membership expired ${expiry.dateLabel}`
      : `, valid through ${expiry.dateLabel}`
    : '';
  const label = `${TIER_TITLE[tier]} gym membership card for ${name}${
    signedIn ? '' : ', local profile — sign in to sync'
  }${expiryLabel}${onPress ? '. Opens subscription options.' : ''}`;

  const statusWord = showExpiry
    ? `${expiry?.expired ? 'EXPIRED' : 'THRU'} ${expiresAt ? shortMonthYear(expiresAt) : ''}`.trim()
    : signedIn
      ? 'ACTIVE'
      : 'LOCAL';

  const face = (
    // The whole face is one flat plane of the tier metal — no artwork layer.
    <View style={[styles.wrap, { backgroundColor: metal.mid }]}>
      {tier === 'elite' ? (
        // Elite hallmark: the ONE flagship embellishment — a thick-thin pair
        // of warm-gold hairlines that give the noir plane a visible perimeter.
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[styles.eliteFrame, styles.eliteFrameOuter, { borderColor: metal.inkDim }]} />
          <View style={[styles.eliteFrame, styles.eliteFrameInner, { borderColor: metal.inkDim }]} />
        </View>
      ) : null}
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topRow}>
          <Text style={[styles.brand, { color: metal.ink }]} numberOfLines={1}>
            GM METHOD
          </Text>
          <Text style={[styles.tierWord, { color: metal.inkDim }]} numberOfLines={1}>
            {TIER_TITLE[tier]}
          </Text>
        </View>
        <View style={styles.heroBlock}>
          <View style={[styles.accentBar, { backgroundColor: metal.stripe }]} />
          <View>
            {foreNames ? (
              <Text style={[styles.eyebrow, { color: metal.inkDim }]} numberOfLines={1}>
                {foreNames}
              </Text>
            ) : null}
            <Text
              style={[styles.hero, { color: metal.ink }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {heroWord}
            </Text>
          </View>
        </View>
        <View style={styles.bottomRow}>
          <Text style={[styles.meta, { color: metal.inkDim }]} numberOfLines={1}>
            •••• {last4}
          </Text>
          <Text style={[styles.meta, { color: metal.inkDim }]} numberOfLines={1}>
            {statusWord}
          </Text>
        </View>
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label}>
        {face}
      </View>
    );
  }
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      {face}
    </PressableScale>
  );
}
