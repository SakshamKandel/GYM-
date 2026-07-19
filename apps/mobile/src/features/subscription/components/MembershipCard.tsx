import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';

/**
 * Membership card — the member's tier rendered as a premium "metal card"
 * (credit-card proportions, per-tier material finish: graphite / silver /
 * gold / black-platinum for elite). Face: brand wordmark, embossed-style
 * holder name, masked member number from the account id, tier title, and a
 * thin signal-red stripe. Entirely local SVG gradients — no images, no
 * network, identical on web and native. Colors come from the dedicated
 * `cardMetals` palette in @gym/ui-tokens (rule 7: no inline hex here).
 *
 * Text uses raw RN <Text> with per-material ink colors because the card is a
 * self-contained "material" surface — AppText's theme ink would fight the
 * gold/silver faces. Sizes stay ≥13 and the whole card carries a summary
 * accessibilityLabel, with inner text hidden from the reader to avoid a
 * word-salad of decorative fragments.
 */

const CARD_RATIO = 1.586; // ISO/IEC 7810 ID-1

const TIER_TITLE: Record<Tier, string> = {
  starter: 'MEMBER',
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE · PLATINUM',
};

interface Props {
  tier: Tier;
  holderName: string;
  /** Account id — only the last 4 characters are shown, card-number style. */
  memberId: string | null;
  /** Signed-out / local-only profiles get a hint instead of a member number. */
  signedIn: boolean;
  onPress?: () => void;
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: CARD_RATIO,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  face: {
    flex: 1,
    padding: spacing.gutter,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brand: {
    fontFamily: type.display,
    fontSize: 15,
    letterSpacing: 3,
  },
  tierTitle: {
    fontFamily: type.display,
    fontSize: 13,
    letterSpacing: 2,
  },
  chipWrap: { marginTop: spacing.sm },
  holder: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  number: {
    fontFamily: type.display,
    fontSize: 18,
    letterSpacing: 4,
    marginBottom: spacing.xs,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  status: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    letterSpacing: 1,
  },
});

/** The EMV-style chip, drawn as a tiny SVG so it scales crisply. */
function Chip({ metal }: { metal: (typeof cardMetals)[CardMetalTier] }) {
  return (
    <Svg width={40} height={30} viewBox="0 0 40 30">
      <Rect x={0} y={0} width={40} height={30} rx={6} fill={metal.sheen} opacity={0.9} />
      <Rect x={2} y={2} width={36} height={26} rx={5} fill={metal.top} />
      <Path
        d="M 2 11 H 14 M 2 19 H 14 M 26 11 H 38 M 26 19 H 38 M 14 2 V 28 M 26 2 V 28"
        stroke={metal.deep}
        strokeWidth={1.4}
        fill="none"
      />
    </Svg>
  );
}

export function MembershipCard({ tier, holderName, memberId, signedIn, onPress }: Props) {
  const metal = cardMetals[tier];
  const last4 = memberId ? memberId.replace(/-/g, '').slice(-4).toUpperCase() : null;
  const label = `${TIER_TITLE[tier]} membership card for ${holderName || 'Athlete'}${
    signedIn ? '' : ', local profile — sign in to sync'
  }${onPress ? '. Opens subscription options.' : ''}`;

  const face = (
    <View style={styles.wrap}>
      <Svg style={styles.svg} viewBox="0 0 320 202" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.55" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.35">
            <Stop offset="0" stopColor={metal.sheen} stopOpacity="0" />
            <Stop offset="0.5" stopColor={metal.sheen} stopOpacity="0.35" />
            <Stop offset="1" stopColor={metal.sheen} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#metal)" />
        {/* Diagonal sheen band — the "light catching metal" read. */}
        <Path d="M 96 -20 L 196 -20 L 116 222 L 16 222 Z" fill="url(#sheen)" />
        {/* Fine engraved lines, lower-right quadrant. */}
        <Path
          d="M 190 202 L 320 96 M 210 202 L 320 118 M 230 202 L 320 140 M 250 202 L 320 162 M 270 202 L 320 184"
          stroke={metal.sheen}
          strokeWidth={0.8}
          opacity={0.35}
          fill="none"
        />
        {/* Signal-red brand stripe along the bottom edge. */}
        <Rect x={0} y={196} width={320} height={6} fill={metal.stripe} />
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topRow}>
          <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
          <Text style={[styles.tierTitle, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
        </View>
        <View style={styles.chipWrap}>
          <Chip metal={metal} />
        </View>
        <View>
          <Text style={[styles.number, { color: metal.ink }]}>
            {last4 ? `••••  ••••  ••••  ${last4}` : '••••  ••••  ••••  ••••'}
          </Text>
          <View style={styles.bottomRow}>
            <Text style={[styles.holder, { color: metal.ink }]} numberOfLines={1}>
              {holderName || 'Athlete'}
            </Text>
            <Text style={[styles.status, { color: metal.inkDim }]}>
              {signedIn ? 'ACTIVE' : 'LOCAL'}
            </Text>
          </View>
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
