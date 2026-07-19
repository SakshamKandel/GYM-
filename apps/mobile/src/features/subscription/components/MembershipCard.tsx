import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';

/**
 * Membership card — the member's tier as a bold GYM card (not a bank card):
 * per-tier metal finish, a WEIGHT-PLATE emblem where a chip would sit, a
 * giant ghosted plate bleeding off the right edge, two signal-red power
 * stripes cutting the top corner, the tier set as oversized Oswald poster
 * type with an accent underline, the brand motto stamped under the wordmark,
 * and the holder's name big along the bottom. Entirely local SVG — no
 * images, no network. Colors come from the `cardMetals` palette in
 * @gym/ui-tokens (rule 7: no inline hex here).
 *
 * Raw RN <Text> with per-material ink colors (the card is a self-contained
 * material surface; theme ink would fight the gold/silver faces). The card
 * carries one summary accessibilityLabel; inner fragments are hidden.
 */

const CARD_RATIO = 1.586; // ISO/IEC 7810 ID-1

const TIER_TITLE: Record<Tier, string> = {
  starter: 'MEMBER',
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE',
};

const TIER_SUB: Record<Tier, string> = {
  starter: 'GM METHOD ATHLETE',
  silver: 'SILVER STANDARD',
  gold: 'GOLD STANDARD',
  elite: 'PLATINUM BLACK',
};

interface Props {
  tier: Tier;
  holderName: string;
  /** Account id — only the last 4 characters are shown. */
  memberId: string | null;
  /** Signed-out / local-only profiles get a hint instead of ACTIVE. */
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
    fontSize: 16,
    letterSpacing: 3,
  },
  motto: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    letterSpacing: 2,
    marginTop: 2,
  },
  memberNo: {
    fontFamily: type.display,
    fontSize: 13,
    letterSpacing: 2,
    textAlign: 'right',
  },
  tierBlock: { marginTop: spacing.xs },
  tierTitle: {
    fontFamily: type.display,
    fontSize: 38,
    letterSpacing: 5,
    lineHeight: 42,
  },
  tierBar: {
    width: 44,
    height: 5,
    borderRadius: 3,
    marginTop: spacing.xs,
  },
  tierSub: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    letterSpacing: 2,
    marginTop: spacing.sm,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  holder: {
    flex: 1,
    fontFamily: type.display,
    fontSize: 21,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginRight: spacing.md,
  },
  statusPill: {
    borderWidth: 1.5,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  statusText: {
    fontFamily: type.bodySemiBold,
    fontSize: 13,
    letterSpacing: 1.5,
  },
});

/** Small solid weight-plate emblem — the gym card's "chip". */
function PlateEmblem({ metal }: { metal: (typeof cardMetals)[CardMetalTier] }) {
  return (
    <Svg width={44} height={44} viewBox="0 0 44 44">
      <Circle cx={22} cy={22} r={21} fill={metal.sheen} opacity={0.95} />
      <Circle cx={22} cy={22} r={17} fill={metal.top} />
      <Circle cx={22} cy={22} r={16.5} stroke={metal.deep} strokeWidth={1} fill="none" />
      <Circle cx={22} cy={22} r={10} stroke={metal.deep} strokeWidth={1.2} fill="none" opacity={0.7} />
      <Circle cx={22} cy={22} r={4.5} fill={metal.deep} />
      {/* Grip notches at the four compass points. */}
      <Path
        d="M 22 1.5 V 6 M 22 38 V 42.5 M 1.5 22 H 6 M 38 22 H 42.5"
        stroke={metal.deep}
        strokeWidth={2.4}
        strokeLinecap="round"
        opacity={0.8}
      />
    </Svg>
  );
}

export function MembershipCard({ tier, holderName, memberId, signedIn, onPress }: Props) {
  const metal = cardMetals[tier];
  const last4 = memberId ? memberId.replace(/-/g, '').slice(-4).toUpperCase() : '0000';
  const label = `${TIER_TITLE[tier]} gym membership card for ${holderName || 'Athlete'}${
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
            <Stop offset="0.5" stopColor={metal.sheen} stopOpacity="0.3" />
            <Stop offset="1" stopColor={metal.sheen} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#metal)" />
        {/* Giant ghosted weight plate bleeding off the right edge. */}
        <Circle cx={292} cy={104} r={92} stroke={metal.sheen} strokeWidth={10} fill="none" opacity={0.10} />
        <Circle cx={292} cy={104} r={64} stroke={metal.sheen} strokeWidth={7} fill="none" opacity={0.12} />
        <Circle cx={292} cy={104} r={38} stroke={metal.sheen} strokeWidth={5} fill="none" opacity={0.14} />
        <Circle cx={292} cy={104} r={13} fill={metal.deep} opacity={0.5} />
        {/* Two power stripes cutting the top-right corner. */}
        <Path d="M 232 -14 L 260 -14 L 176 216 L 148 216 Z" fill={metal.stripe} opacity={0.85} />
        <Path d="M 276 -14 L 290 -14 L 206 216 L 192 216 Z" fill={metal.stripe} opacity={0.45} />
        {/* Diagonal light sheen across the metal. */}
        <Path d="M 70 -20 L 170 -20 L 90 222 L -10 222 Z" fill="url(#sheen)" />
        {/* Signal-red base stripe. */}
        <Rect x={0} y={196} width={320} height={6} fill={metal.stripe} />
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
            <Text style={[styles.motto, { color: metal.inkDim }]}>TRAIN · EAT · GROW</Text>
          </View>
          <View>
            <Text style={[styles.memberNo, { color: metal.inkDim }]}>NO. {last4}</Text>
          </View>
        </View>
        <View style={styles.tierBlock}>
          <Text style={[styles.tierTitle, { color: metal.ink }]}>{TIER_TITLE[tier]}</Text>
          <View style={[styles.tierBar, { backgroundColor: metal.stripe }]} />
          <Text style={[styles.tierSub, { color: metal.inkDim }]}>{TIER_SUB[tier]}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={[styles.holder, { color: metal.ink }]} numberOfLines={1}>
            {holderName || 'Athlete'}
          </Text>
          <View style={{ marginRight: spacing.md }}>
            <PlateEmblem metal={metal} />
          </View>
          <View style={[styles.statusPill, { borderColor: metal.inkDim }]}>
            <Text style={[styles.statusText, { color: metal.ink }]}>
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
