import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';

/**
 * Membership card v3 — true premium restraint (the reference is a metal
 * Centurion-class card, not a gym flyer): a matte per-tier metal face with a
 * fine BRUSHED texture (dozens of hairline strokes), a barely-there weight
 * plate watermark, an engraved-feel FULL NAME as the hero (two lines
 * allowed, subtle deboss shadow), a small chip, and exactly ONE thin accent
 * line. No stripes, no loud shapes — premium is what's left out.
 * All local SVG; colors only from cardMetals (rule 7).
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
    alignItems: 'center',
  },
  brand: {
    fontFamily: type.display,
    fontSize: 14,
    letterSpacing: 4,
  },
  tierWord: {
    fontFamily: type.bodySemiBold,
    fontSize: 13,
    letterSpacing: 3,
  },
  centerBlock: { gap: spacing.md },
  accentLine: {
    width: 34,
    height: 2,
    borderRadius: 1,
  },
  holder: {
    fontFamily: type.display,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  metaLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    letterSpacing: 1.5,
  },
  metaValue: {
    fontFamily: type.display,
    fontSize: 14,
    letterSpacing: 3,
    marginTop: 2,
  },
});

/** Slim metal chip — quiet, engraved. */
function Chip({ metal }: { metal: (typeof cardMetals)[CardMetalTier] }) {
  return (
    <Svg width={34} height={26} viewBox="0 0 34 26">
      <Rect x={0.5} y={0.5} width={33} height={25} rx={5} fill={metal.mid} stroke={metal.sheen} strokeWidth={0.8} opacity={0.95} />
      <Line x1={0} y1={9} x2={11} y2={9} stroke={metal.deep} strokeWidth={1} />
      <Line x1={0} y1={17} x2={11} y2={17} stroke={metal.deep} strokeWidth={1} />
      <Line x1={23} y1={9} x2={34} y2={9} stroke={metal.deep} strokeWidth={1} />
      <Line x1={23} y1={17} x2={34} y2={17} stroke={metal.deep} strokeWidth={1} />
      <Line x1={11} y1={2} x2={11} y2={24} stroke={metal.deep} strokeWidth={1} />
      <Line x1={23} y1={2} x2={23} y2={24} stroke={metal.deep} strokeWidth={1} />
    </Svg>
  );
}

export function MembershipCard({ tier, holderName, memberId, signedIn, onPress }: Props) {
  const metal = cardMetals[tier];
  const last4 = memberId ? memberId.replace(/-/g, '').slice(-4).toUpperCase() : '0000';
  const name = (holderName || 'Athlete').trim();
  const label = `${TIER_TITLE[tier]} gym membership card for ${name}${
    signedIn ? '' : ', local profile — sign in to sync'
  }${onPress ? '. Opens subscription options.' : ''}`;

  // Brushed-metal hairlines: precomputed static rows (no randomness — the
  // texture must be identical every render and on both platforms).
  const hairlines: number[] = [];
  for (let y = 6; y < 202; y += 4) hairlines.push(y);

  const face = (
    <View style={styles.wrap}>
      <Svg style={styles.svg} viewBox="0 0 320 202" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="metal" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.5" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          <LinearGradient id="glint" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={metal.sheen} stopOpacity="0" />
            <Stop offset="0.35" stopColor={metal.sheen} stopOpacity="0.16" />
            <Stop offset="0.5" stopColor={metal.sheen} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#metal)" />
        {/* Brushed texture — fine hairlines across the whole face. */}
        {hairlines.map((y, i) => (
          <Line
            key={y}
            x1={-4}
            y1={y}
            x2={324}
            y2={y}
            stroke={i % 2 === 0 ? metal.sheen : metal.deep}
            strokeWidth={0.5}
            opacity={i % 2 === 0 ? 0.05 : 0.07}
          />
        ))}
        {/* One soft vertical glint. */}
        <Rect x={0} y={0} width={320} height={202} fill="url(#glint)" />
        {/* Barely-there plate watermark, off-right. */}
        <Circle cx={296} cy={101} r={86} stroke={metal.sheen} strokeWidth={12} fill="none" opacity={0.045} />
        <Circle cx={296} cy={101} r={52} stroke={metal.sheen} strokeWidth={8} fill="none" opacity={0.05} />
        <Circle cx={296} cy={101} r={20} stroke={metal.sheen} strokeWidth={5} fill="none" opacity={0.055} />
        {/* Hairline inner frame — the machined edge. */}
        <Rect
          x={1.25}
          y={1.25}
          width={317.5}
          height={199.5}
          rx={14}
          fill="none"
          stroke={metal.sheen}
          strokeWidth={0.8}
          opacity={0.22}
        />
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topRow}>
          <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
          <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
        </View>
        <View style={styles.centerBlock}>
          <Chip metal={metal} />
          <View style={[styles.accentLine, { backgroundColor: metal.stripe }]} />
          <Text
            style={[
              styles.holder,
              {
                color: metal.ink,
                textShadowColor: metal.deep,
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 1,
              },
            ]}
            numberOfLines={2}
          >
            {name}
          </Text>
        </View>
        <View style={styles.bottomRow}>
          <View>
            <Text style={[styles.metaLabel, { color: metal.inkDim }]}>MEMBER NO.</Text>
            <Text style={[styles.metaValue, { color: metal.ink }]}>•••• {last4}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.metaLabel, { color: metal.inkDim }]}>STATUS</Text>
            <Text style={[styles.metaValue, { color: metal.ink }]}>
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
