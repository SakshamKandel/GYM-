import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "ART DECO PAVILION".
 *
 * The reference is 1925 Paris by way of the Chrysler lobby: a sunburst of
 * eleven wedge rays fans down from a crown just above the top edge, EXACTLY
 * mirror-symmetric about the card's vertical axis (a center ray straddles
 * straight-down, every other wedge has its mirror twin). The fan sits behind
 * a thin double-rule frame whose inner rule breaks into two setback steps at
 * each corner — the ziggurat silhouette — with a small diamond jewel set in
 * each corner notch. Dead-center under the crown, a keystone chip flanked by
 * inward chevrons; typography is tracked wide and centered like a theatre
 * marquee, the tier word flanked by twin rules.
 *
 * All geometry is precomputed module constants (fixed angles, no randomness
 * — identical every render on every platform). Engraving strokes pick
 * `deep` ink on the light silver/gold faces, `sheen` on the dark starter
 * face, and warm `inkDim` gold on the near-black elite face (its sheen is
 * near-invisible there) so the etch reads on all four tiers. Elite alone
 * also gets a gilded second stepped hairline — a fine double gold frame.
 * All artwork is local SVG; colors only from cardMetals (rule 7).
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

/** MM/YY for the card's VALID THRU corner. Empty string on an unparseable value. */
function shortMonthYear(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${mm}/${yy}`;
}

// ── Precomputed sunburst (module constants — deterministic) ──────────────

/** Fan origin: the crown, top-center just above the card edge. */
const BURST_ORIGIN = { x: 160, y: -12 } as const;
/** Ray length — far enough to sweep past the bottom corners. */
const BURST_LEN = 300;
/** Angular pitch between ray centers (degrees). */
const BURST_PITCH = 12;
/** Half-width of each wedge (degrees). */
const BURST_HALF = 2.5;

/**
 * Eleven wedge centers, mirror-symmetric about straight-down (90 degrees):
 * one center ray plus five mirrored pairs, 30..150 in 12-degree steps.
 */
const BURST_CENTERS: readonly number[] = Object.freeze(
  Array.from({ length: 11 }, (_, i) => 90 + (i - 5) * BURST_PITCH),
);

function rayPoint(deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: BURST_ORIGIN.x + BURST_LEN * Math.cos(rad),
    y: BURST_ORIGIN.y + BURST_LEN * Math.sin(rad),
  };
}

/** Wedge path strings, computed once at module load. */
const BURST_PATHS: readonly string[] = Object.freeze(
  BURST_CENTERS.map((c) => {
    const p1 = rayPoint(c - BURST_HALF);
    const p2 = rayPoint(c + BURST_HALF);
    return `M ${BURST_ORIGIN.x} ${BURST_ORIGIN.y} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} Z`;
  }),
);

// ── Stepped inner frame + corner jewels (module constants) ───────────────

/**
 * Inner rule of the double frame at inset 12, its sharp corners replaced by
 * two equal 5-unit setback steps — the deco ziggurat silhouette, drawn
 * clockwise from the top-left corner exit.
 */
const STEPPED_FRAME =
  'M 22 12 H 298 L 298 17 L 303 17 L 303 22 L 308 22 V 180 ' +
  'L 303 180 L 303 185 L 298 185 L 298 190 H 22 L 22 185 L 17 185 ' +
  'L 17 180 L 12 180 V 22 L 17 22 L 17 17 L 22 17 Z';

/** Small diamond jewel set in the top-left corner step notch. */
const CORNER_DIAMOND = 'M 17 14.6 L 19.4 17 L 17 19.4 L 14.6 17 Z';

/**
 * Elite-only flourish: the stepped frame echoed 3 units further in — same
 * 5-unit ziggurat setbacks — drawn as a warm-cream hairline so the inner
 * rule becomes a fine DOUBLE gold frame on the noir face.
 */
const ELITE_STEPPED_ECHO =
  'M 25 15 H 295 L 295 20 L 300 20 L 300 25 L 305 25 V 177 ' +
  'L 300 177 L 300 182 L 295 182 L 295 187 H 25 L 25 182 L 20 182 ' +
  'L 20 177 L 15 177 V 25 L 20 25 L 20 20 L 25 20 Z';

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
    paddingVertical: spacing.gutter,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBlock: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  brand: {
    fontFamily: type.display,
    fontSize: 15,
    letterSpacing: 6,
    textAlign: 'center',
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tierRule: {
    width: 22,
    height: 1,
  },
  tierWord: {
    fontFamily: type.bodySemiBold,
    fontSize: 12,
    letterSpacing: 5,
    textAlign: 'center',
  },
  holder: {
    fontFamily: type.display,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  bottomRow: {
    width: '100%',
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

/** Keystone chip flanked by inward deco chevrons — the marquee centerpiece. */
function KeystoneChip({
  metal,
  etch,
  contact,
}: {
  metal: (typeof cardMetals)[CardMetalTier];
  etch: string;
  /** Ink for the chip's contact lines — `deep` except on elite, where deep-on-near-black vanishes. */
  contact: string;
}) {
  return (
    <Svg width={92} height={26} viewBox="0 0 92 26">
      {/* Left chevrons, pointing in, fading outward. */}
      <Path d="M 12 6 L 20 13 L 12 20" fill="none" stroke={etch} strokeWidth={1.2} opacity={0.75} />
      <Path d="M 4 6 L 12 13 L 4 20" fill="none" stroke={etch} strokeWidth={1.2} opacity={0.4} />
      {/* Keystone chip — a trapezoid, wider at the top like a voussoir. */}
      <Path
        d="M 32 1 L 60 1 L 56 25 L 36 25 Z"
        fill={metal.mid}
        stroke={etch}
        strokeWidth={0.8}
        opacity={0.95}
      />
      {/* Contact lines, tapered to follow the keystone's sides. */}
      <Line x1={38} y1={9} x2={54} y2={9} stroke={contact} strokeWidth={1} />
      <Line x1={39} y1={17} x2={53} y2={17} stroke={contact} strokeWidth={1} />
      {/* Right chevrons — mirror of the left pair. */}
      <Path d="M 80 6 L 72 13 L 80 20" fill="none" stroke={etch} strokeWidth={1.2} opacity={0.75} />
      <Path d="M 88 6 L 80 13 L 88 20" fill="none" stroke={etch} strokeWidth={1.2} opacity={0.4} />
    </Svg>
  );
}

export function MembershipCardArtDeco({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
  // Silver/gold faces are LIGHT metal — sheen-colored etching vanishes on
  // them, so engraving strokes flip to `deep` ink there and stay `sheen`
  // (lit engraving) on the dark starter face. Elite is NEAR-BLACK: its
  // sheen is itself near-black, so the flagship etches in warm inkDim gold
  // instead — the sunburst and frame read as gilded engraving.
  const lightFace = tier === 'silver' || tier === 'gold';
  const elite = tier === 'elite';
  const etch = lightFace ? metal.deep : elite ? metal.inkDim : metal.sheen;
  const rayPeak = lightFace ? 0.11 : elite ? 0.15 : 0.17;
  const last4 = memberId ? memberId.replace(/-/g, '').slice(-4).toUpperCase() : '0000';
  const name = (holderName || 'Athlete').trim();
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

  const face = (
    <View style={styles.wrap}>
      <Svg style={styles.svg} viewBox="0 0 320 202" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="adMetal" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.55" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          {/* One shared crown-to-floor fade for every ray (user-space units,
              so all eleven wedges dim on the same axis). */}
          <LinearGradient id="adRay" x1="0" y1="0" x2="0" y2="202" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={etch} stopOpacity={rayPeak} />
            <Stop offset="1" stopColor={etch} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#adMetal)" />
        {/* Sunburst — eleven mirror-symmetric wedges from the crown; the
            stroke etches BOTH edges of every wedge. */}
        {BURST_PATHS.map((d) => (
          <Path
            key={d}
            d={d}
            fill="url(#adRay)"
            stroke={etch}
            strokeWidth={0.6}
            strokeOpacity={lightFace ? 0.16 : elite ? 0.3 : 0.2}
          />
        ))}
        {/* Double-rule frame: a plain outer rule following the card edge… */}
        <Rect
          x={6.5}
          y={6.5}
          width={307}
          height={189}
          rx={13}
          fill="none"
          stroke={etch}
          strokeWidth={1}
          opacity={0.5}
        />
        {/* …and an inner rule with two setback steps at each corner. */}
        <Path d={STEPPED_FRAME} fill="none" stroke={etch} strokeWidth={0.7} opacity={0.4} />
        {/* Elite flourish: a gilded second stepped hairline in warm cream —
            with the inkDim rule above it, a fine double gold frame. */}
        {elite ? (
          <Path
            d={ELITE_STEPPED_ECHO}
            fill="none"
            stroke={metal.ink}
            strokeWidth={0.5}
            opacity={0.3}
          />
        ) : null}
        {/* Diamond jewels seated in the four corner step notches. */}
        <G fill={etch} opacity={0.5}>
          <Path d={CORNER_DIAMOND} />
          <Path d={CORNER_DIAMOND} transform="translate(320,0) scale(-1,1)" />
          <Path d={CORNER_DIAMOND} transform="translate(0,202) scale(1,-1)" />
          <Path d={CORNER_DIAMOND} transform="translate(320,202) scale(-1,-1)" />
        </G>
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topBlock}>
          <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
          <View style={styles.tierRow}>
            <View style={[styles.tierRule, { backgroundColor: metal.inkDim, opacity: 0.55 }]} />
            <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
            <View style={[styles.tierRule, { backgroundColor: metal.inkDim, opacity: 0.55 }]} />
          </View>
        </View>
        <View style={styles.topBlock}>
          <KeystoneChip metal={metal} etch={etch} contact={elite ? metal.inkDim : metal.deep} />
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
            {showExpiry && expiresAt ? (
              <>
                <Text style={[styles.metaLabel, { color: metal.inkDim }]}>
                  {expiry?.expired ? 'EXPIRED' : 'VALID THRU'}
                </Text>
                <Text style={[styles.metaValue, { color: metal.ink }]}>
                  {shortMonthYear(expiresAt)}
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.metaLabel, { color: metal.inkDim }]}>STATUS</Text>
                <Text style={[styles.metaValue, { color: metal.ink }]}>
                  {signedIn ? 'ACTIVE' : 'LOCAL'}
                </Text>
              </>
            )}
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
