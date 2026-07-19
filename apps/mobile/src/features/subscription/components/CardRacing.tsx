import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "RACING" (motorsport livery).
 *
 * The reference is a factory GT livery, not a gym flyer: ONE stripe cluster —
 * two trailing micro-ticks, a drafting companion band, and the bold red lead
 * band (metal.stripe) with taped-trim hairlines on both edges — sweeps the
 * face at exactly 45°, rising from bottom-centre and diving behind a
 * number-bib plate in the top-right corner before exiting the edge. The bib
 * is a true race board: an ink-filled clipped-corner plate (white board on
 * the dark tiers, dark board on silver/gold — Silver-Arrows style) carrying
 * the tier's door number and a mini checkered strip. A 45° clear-coat gloss
 * and three micro-ticks beside the name repeat the livery angle at macro and
 * micro scale — every diagonal on the face shares the same slant.
 *
 * Discipline notes: no italics (Oswald ships no italic face and synthetic
 * slanting is unreliable on Android — speed comes from geometry, not faux
 * type); the holder name is width-capped so it can never run under the
 * saturated red band; the bib number overlay is positioned in PERCENTAGES of
 * the card so it stays glued to the SVG plate at every rendered width (the
 * SVG itself stretches via preserveAspectRatio="none"). All geometry is
 * precomputed module constants — no randomness — and all artwork is local
 * SVG; colors only from cardMetals (rule 7).
 *
 * ELITE (noir) treatment: elite's cool graphite sheen vanishes on its
 * near-black metal, so every sheen-drawn supporting element — trailing
 * ticks, drafting band, taped-trim hairlines, clear-coat gloss, edge frame,
 * speed-tick echoes — switches to the warm champagne `inkDim` register on
 * elite ONLY (the red band's tape trim thereby reads as gilded edging).
 * Elite also carries ONE exclusive flourish: a second inner gold hairline
 * concentric with the machined edge frame — a fine double gold coachline,
 * kept in the outer margin so it never nears text. Starter/silver/gold
 * branches are byte-identical to before.
 */

const CARD_RATIO = 1.586; // ISO/IEC 7810 ID-1

const TIER_TITLE: Record<Tier, string> = {
  starter: 'MEMBER',
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE',
};

/** Racing door number per tier — what the bib plate carries. */
const TIER_NUMBER: Record<Tier, string> = {
  starter: '01',
  silver: '22',
  gold: '33',
  elite: '44',
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

// ── Livery geometry (module constants — deterministic) ────────────────────
// Every band edge is the 45° line x = c + (234 − y), swept from below the
// bottom edge (y=234) to above the top (y=−14) so the slant never clips
// inside the card. Positions are chosen so the opaque red band threads the
// text-free channel: clear of MEMBER NO. (ends ~x91), the width-capped name
// (ends ~x188), and VALID THRU / STATUS (starts ~x212) — verified at the
// y-extents of each text block. Only low-opacity same-material tints may
// pass near text.

/** Δx of every 45° edge over the y-run 234 → −14. */
const SLANT_RUN = 248;

/** Parallelogram band with leading edge at x=c (measured at y=234), width w. */
function bandPath(c: number, w: number): string {
  return `M ${c} 234 L ${c + SLANT_RUN} -14 L ${c + w + SLANT_RUN} -14 L ${c + w} 234 Z`;
}

/** Hairline along a single 45° edge at x=c. */
function edgePath(c: number): string {
  return `M ${c} 234 L ${c + SLANT_RUN} -14`;
}

/** Trailing micro-ticks → companion band → bold red lead band (left→right). */
const TICK_A = bandPath(60, 3);
const TICK_B = bandPath(68, 4);
const BAND_METAL = bandPath(76, 14);
const BAND_RED = bandPath(98, 30);
/** Taped-trim hairlines on both edges of the red band. */
const TRIM_LEAD = edgePath(98);
const TRIM_TRAIL = edgePath(128);

/** Bib plate, top-right: clipped-corner board spanning x 244–304, y 14–58. */
const BIB_PLATE = '252,14 296,14 304,22 304,50 296,58 252,58 244,50 244,22';

/** Mini checkered strip inside the plate's lower band — two offset rows. */
const CHECKER_ROW_A: readonly number[] = Object.freeze(
  Array.from({ length: 6 }, (_, i) => 250 + i * 8),
);
const CHECKER_ROW_B: readonly number[] = Object.freeze(
  Array.from({ length: 6 }, (_, i) => 254 + i * 8),
);

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
  brand: {
    fontFamily: type.display,
    fontSize: 14,
    letterSpacing: 4,
  },
  tierWord: {
    fontFamily: type.bodySemiBold,
    fontSize: 13,
    letterSpacing: 3,
    marginTop: 2,
  },
  /**
   * Number zone of the bib plate, as fractions of the card so it tracks the
   * stretched SVG at any width: x 244–304 → right 16/320 = 5%, width
   * 60/320 = 18.75%; y 14–46 (above the checkered strip) → top 14/202 =
   * 6.93%, height 32/202 = 15.84%.
   */
  bibNumber: {
    position: 'absolute',
    top: '6.93%',
    right: '5%',
    width: '18.75%',
    height: '15.84%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bibText: {
    fontFamily: type.display,
    fontSize: 22,
    lineHeight: 24,
    letterSpacing: 1,
    includeFontPadding: false,
  },
  holderBlock: { gap: spacing.sm },
  tickMotif: {
    width: 34,
    height: 12,
  },
  holder: {
    fontFamily: type.display,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    maxWidth: '60%',
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

/**
 * The race-number board rendered in the SVG layer: ink-filled clipped-corner
 * plate (the tier's opposite pole, so it reads as a true bib on every face),
 * sheen keyline, and a two-row mini checkered strip along its lower band.
 */
function BibPlateArt({ metal }: { metal: (typeof cardMetals)[CardMetalTier] }) {
  return (
    <>
      <Polygon points={BIB_PLATE} fill={metal.ink} opacity={0.96} />
      <Polygon
        points={BIB_PLATE}
        fill="none"
        stroke={metal.sheen}
        strokeWidth={1.2}
        opacity={0.9}
      />
      {CHECKER_ROW_A.map((x) => (
        <Rect key={`ca${x}`} x={x} y={46} width={4} height={3} fill={metal.top} opacity={0.9} />
      ))}
      {CHECKER_ROW_B.map((x) => (
        <Rect key={`cb${x}`} x={x} y={49} width={4} height={3} fill={metal.top} opacity={0.9} />
      ))}
    </>
  );
}

/**
 * Three micro-ticks beside the holder name — the livery's 45° slant repeated
 * at micro scale (red lead, two fading echoes). Replaces the reference
 * card's flat accent line. Elite's echoes go warm champagne (`inkDim`) —
 * sheen is invisible on the noir metal.
 */
function SpeedTicks({
  metal,
  elite,
}: {
  metal: (typeof cardMetals)[CardMetalTier];
  elite: boolean;
}) {
  const echo = elite ? metal.inkDim : metal.sheen;
  return (
    <Svg style={styles.tickMotif} viewBox="0 0 34 12">
      <Path d="M 0 12 L 8 4 L 14 4 L 6 12 Z" fill={metal.stripe} />
      <Path d="M 11 12 L 19 4 L 24 4 L 16 12 Z" fill={echo} opacity={0.7} />
      <Path d="M 21 12 L 29 4 L 33 4 L 25 12 Z" fill={echo} opacity={elite ? 0.45 : 0.4} />
    </Svg>
  );
}

export function MembershipCardRacing({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
  // Elite-only rendering branches (visibility + flourish) — see header note.
  const isElite = tier === 'elite';
  const engrave = isElite ? metal.inkDim : metal.sheen;
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
          <LinearGradient id="racingMetal" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.5" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          {/* Light falls from the top of the red band, like paint under sun. */}
          <LinearGradient id="racingRed" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={metal.stripe} stopOpacity="1" />
            <Stop offset="1" stopColor={metal.stripe} stopOpacity="0.84" />
          </LinearGradient>
          {/* Clear-coat gloss band at the SAME 45° as the livery (axis runs
              perpendicular to the stripes, in user space so the angle is exact).
              Elite: a faint WARM lacquer sweep — sheen reads as nothing there. */}
          <LinearGradient
            id="racingGloss"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="-40"
            x2="280"
            y2="240"
          >
            <Stop offset="0" stopColor={engrave} stopOpacity="0" />
            <Stop offset="0.5" stopColor={engrave} stopOpacity={isElite ? '0.09' : '0.1'} />
            <Stop offset="1" stopColor={engrave} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#racingMetal)" />
        {/* The stripe cluster — trailing ticks, drafting companion, red lead.
            Elite: supporting bands in champagne inkDim (opacities trimmed —
            inkDim sits far brighter over the noir metal than sheen does over
            the other tiers'), and the tape trim becomes gilded edging. */}
        <Path d={TICK_A} fill={engrave} opacity={isElite ? 0.24 : 0.2} />
        <Path d={TICK_B} fill={engrave} opacity={isElite ? 0.36 : 0.3} />
        <Path d={BAND_METAL} fill={engrave} opacity={isElite ? 0.34 : 0.45} />
        <Path d={BAND_RED} fill="url(#racingRed)" />
        <Path d={TRIM_LEAD} stroke={engrave} strokeWidth={0.7} opacity={isElite ? 0.9 : 0.55} fill="none" />
        <Path d={TRIM_TRAIL} stroke={engrave} strokeWidth={0.7} opacity={isElite ? 0.9 : 0.55} fill="none" />
        {/* Clear-coat over the paintwork; the bib sticker goes on top of it. */}
        <Rect x={0} y={0} width={320} height={202} fill="url(#racingGloss)" />
        <BibPlateArt metal={metal} />
        {/* Machined edge frame (gold on elite so it survives the noir metal). */}
        <Rect
          x={1.25}
          y={1.25}
          width={317.5}
          height={199.5}
          rx={14}
          fill="none"
          stroke={engrave}
          strokeWidth={0.8}
          opacity={isElite ? 0.5 : 0.22}
        />
        {/* ELITE FLOURISH — the one elite-exclusive embellishment: a second
            inner gold hairline concentric with the frame, forming a fine
            double coachline (pinstriped coachwork). Lives entirely in the
            outer margin (inset 4.75 < gutter 20) so it never nears text. */}
        {isElite ? (
          <Rect
            x={4.75}
            y={4.75}
            width={310.5}
            height={192.5}
            rx={10.5}
            fill="none"
            stroke={metal.inkDim}
            strokeWidth={0.5}
            opacity={0.38}
          />
        ) : null}
      </Svg>
      {/* Door number, centred in the plate's number zone at any card width. */}
      <View
        style={styles.bibNumber}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.bibText, { color: metal.top }]}>{TIER_NUMBER[tier]}</Text>
      </View>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View>
          <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
          <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
        </View>
        <View style={styles.holderBlock}>
          <SpeedTicks metal={metal} elite={isElite} />
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
