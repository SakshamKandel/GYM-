import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "MARBLE".
 *
 * A polished slab of stone, cut per tier: the light faces (silver, gold) are
 * Calacatta — pale stone with dark mineral veining — while the dark faces
 * (starter, elite) are Nero Marquina — near-black stone with light veining.
 * One dominant vein drifts corner-to-corner in taut runs broken by sudden
 * kinks (real veins drift, they don't oscillate); a calmer second vein
 * crosses the lower third; a steep tributary drops from the top edge and
 * junctions with the main vein. Feather capillaries fork off the majors at
 * shared anchor points, short core segments thicken the vein body where the
 * mineral pools, and a kintsugi foil highlight — exact sub-segments of the
 * vein paths, nudged toward the light — rides the dominant vein, pooling as
 * two tiny flecks at the junctions. No chip: a round foil inlay with a
 * signal-red jewel marks the tier instead. Organic where Carbon is gridded,
 * calm where Guilloché is dense.
 *
 * Elite cut (flagship): the elite palette's `sheen` is darker than its ink
 * and disappears on the near-black slab, so elite alone swaps the halo and
 * tone-cloud to the warm gold `inkDim` and lifts every vein layer's opacity —
 * gold-dust Portoro rather than gray Marquina — and receives the one
 * elite-only embellishment: a gilded double-fillet hairline frame inlaid
 * just inside the slab edge. Starter/silver/gold render exactly as before.
 *
 * Every `d` string is a hand-authored module constant — no randomness, no
 * per-render math — so the stone is identical on every render and on both
 * platforms. All artwork is local SVG; colors only from cardMetals (rule 7).
 */

const CARD_RATIO = 1.586; // ISO/IEC 7810 ID-1

const TIER_TITLE: Record<Tier, string> = {
  starter: 'MEMBER',
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE',
};

/**
 * Faces whose cardMetals palette is dark stone with light ink (the brief's
 * "starter/elite are DARK" rule). Light stone takes `deep` veins; dark stone
 * takes `inkDim` veins with a `sheen` bloom, and its foil highlight is `ink`
 * (the brightest token on those palettes — `sheen` is darker than the ink
 * there and would vanish). Elite further swaps its bloom/cloud to `inkDim`
 * and raises vein opacities — see the elite-cut note in the header.
 */
const DARK_STONE: ReadonlySet<Tier> = new Set<Tier>(['starter', 'elite']);

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

// ── Hand-authored stone plates (module constants — deterministic) ────────
//
// Vein character: long taut drifts with sudden slope changes at the nodes
// (shallow → steep → shallow), never a regular S-wave. The three majors
// cross the 320×202 face so the tributary junctions with the main vein at
// ≈(243, 99). Feathers fork FROM nodes that lie on the majors; core and
// foil paths reuse exact major sub-segments so every layer hugs one line.

const VEIN_MAJOR: readonly string[] = Object.freeze([
  // Dominant vein: enters top-left under the brand line, drifts to the right
  // edge in shallow/steep runs. Nodes: 52,38 · 96,52 · 142,66 · 182,86 ·
  // 232,96 · 280,112.
  'M -6 26 C 18 32, 30 33, 52 38 C 70 42, 84 44, 96 52 C 108 60, 122 63, 142 66 C 160 69, 168 78, 182 86 C 202 94, 214 93, 232 96 C 254 100, 262 106, 280 112 C 296 117, 310 116, 326 120',
  // Second vein: calm sag across the lower third, cresting toward the right.
  'M -8 156 C 24 160, 44 168, 76 170 C 100 172, 118 166, 148 168 C 178 170, 196 178, 224 176 C 250 174, 268 164, 292 158 C 304 155, 314 152, 328 148',
  // Steep tributary: drops off the top edge and crosses the main vein.
  'M 252 -6 C 246 14, 256 28, 250 46 C 245 60, 252 72, 246 88 C 242 99, 246 108, 242 118',
]);

/**
 * Core segments — exact sub-segments of the majors drawn thicker, so the
 * vein swells where the mineral pooled instead of staying a uniform stroke.
 */
const VEIN_CORE: readonly string[] = Object.freeze([
  'M 52 38 C 70 42, 84 44, 96 52',
  'M 182 86 C 202 94, 214 93, 232 96',
  'M 224 176 C 250 174, 268 164, 292 158',
  'M 250 46 C 245 60, 252 72, 246 88',
]);

/** Feather capillaries — each forks from a node that lies on a major vein. */
const VEIN_FEATHER: readonly string[] = Object.freeze([
  'M 96 52 C 106 40, 122 34, 132 22 C 138 14, 140 6, 146 -4',
  'M 182 86 C 172 100, 156 106, 148 120 C 142 130, 142 140, 136 152',
  'M 148 168 C 154 178, 166 184, 170 194 C 172 200, 176 206, 178 212',
  'M 250 46 C 262 40, 272 42, 284 34 C 292 28, 296 20, 304 12',
  'M 76 170 C 66 158, 52 154, 44 142 C 38 132, 38 124, 30 114',
  'M 292 158 C 298 168, 308 172, 312 182',
]);

/**
 * Kintsugi foil — the same vein sub-segments nudged ~2px toward the top
 * light, so the highlight sits on the lit lip of the groove, never floating
 * beside it.
 */
const VEIN_FOIL: readonly string[] = Object.freeze([
  'M 96 50 C 108 58, 122 61, 142 64 C 160 67, 168 76, 182 84',
  'M 232 94 C 254 98, 262 104, 280 110',
  'M 248 46 C 243 60, 250 72, 244 88',
]);

/** Foil flecks — tiny pools of leaf where the veins branch and junction. */
const FOIL_FLECKS: ReadonlyArray<{ cx: number; cy: number; r: number }> = Object.freeze([
  { cx: 243, cy: 98, r: 1.4 }, // main × tributary junction
  { cx: 96, cy: 50, r: 1.1 }, // main-vein kink where the top feather forks
]);

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
  inlay: {
    width: 24,
    height: 24,
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

/**
 * Round foil inlay set into the stone — machined ring, engraved groove, and
 * a single signal-red jewel (this face's one brand accent, the counterpart
 * of the reference card's red accent line).
 */
function FoilInlay({ metal }: { metal: (typeof cardMetals)[CardMetalTier] }) {
  return (
    <Svg style={styles.inlay} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={11} fill={metal.mid} stroke={metal.sheen} strokeWidth={1} opacity={0.95} />
      <Circle cx={12} cy={12} r={7.5} fill="none" stroke={metal.deep} strokeWidth={0.7} opacity={0.55} />
      <Circle cx={12} cy={12} r={2.4} fill={metal.stripe} />
      <Circle cx={8.8} cy={8.4} r={1.3} fill={metal.sheen} opacity={0.8} />
    </Svg>
  );
}

export function MembershipCardMarble({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
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

  // Stone cut per tier (see DARK_STONE): Calacatta = dark veins on light
  // stone; Nero Marquina = light veins with a soft sheen bloom on dark stone.
  // Elite-only overrides (see header): its sheen is darker than its ink and
  // vanishes on the near-black slab, so the flagship cut runs the halo and
  // tone-cloud in warm gold `inkDim` and lifts each vein layer's opacity.
  // All other tiers keep the exact original values.
  const darkStone = DARK_STONE.has(tier);
  const elite = tier === 'elite';
  const veinInk = darkStone ? metal.inkDim : metal.deep;
  const veinHalo = elite ? metal.inkDim : darkStone ? metal.sheen : metal.deep;
  const foilInk = darkStone ? metal.ink : metal.sheen;
  const cloudInk = elite ? metal.inkDim : darkStone ? metal.sheen : metal.deep;
  const haloOpacity = elite ? 0.16 : darkStone ? 0.12 : 0.08;
  const veinOpacity = elite ? 0.55 : 0.3;
  const coreOpacity = elite ? 0.7 : 0.42;
  const featherOpacity = elite ? 0.32 : 0.16;

  const face = (
    <View style={styles.wrap}>
      <Svg style={styles.svg} viewBox="0 0 320 202" preserveAspectRatio="none">
        <Defs>
          {/* Polished slab, lit from the upper left. */}
          <LinearGradient id="marbleSlab" x1="0.15" y1="0" x2="0.75" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.65" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          {/* Soft daylight pooled on the upper-left of the slab. */}
          <RadialGradient id="marbleLight" cx="0.22" cy="0.08" r="0.9">
            <Stop offset="0" stopColor={metal.sheen} stopOpacity="0.14" />
            <Stop offset="0.5" stopColor={metal.sheen} stopOpacity="0.05" />
            <Stop offset="1" stopColor={metal.sheen} stopOpacity="0" />
          </RadialGradient>
          {/* Broad diagonal cloud of tone variation — stone is never flat. */}
          <LinearGradient id="marbleCloud" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={cloudInk} stopOpacity="0.1" />
            <Stop offset="0.45" stopColor={cloudInk} stopOpacity="0" />
            <Stop offset="0.8" stopColor={cloudInk} stopOpacity="0.07" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#marbleSlab)" />
        <Rect x={0} y={0} width={320} height={202} fill="url(#marbleCloud)" />
        {/* Diffuse mineral halo — the blur of pigment around each vein. */}
        {VEIN_MAJOR.map((d) => (
          <Path key={`hl${d}`} d={d} fill="none" stroke={veinHalo} strokeWidth={6} opacity={haloOpacity} strokeLinecap="round" />
        ))}
        {/* Vein body. */}
        {VEIN_MAJOR.map((d) => (
          <Path key={`vn${d}`} d={d} fill="none" stroke={veinInk} strokeWidth={1.3} opacity={veinOpacity} strokeLinecap="round" />
        ))}
        {/* Core swells — the vein thickens where the mineral pooled. */}
        {VEIN_CORE.map((d) => (
          <Path key={`co${d}`} d={d} fill="none" stroke={veinInk} strokeWidth={2.2} opacity={coreOpacity} strokeLinecap="round" />
        ))}
        {/* Feather capillaries — barely-there forks off the majors. */}
        {VEIN_FEATHER.map((d) => (
          <Path key={`ft${d}`} d={d} fill="none" stroke={veinInk} strokeWidth={0.7} opacity={featherOpacity} strokeLinecap="round" />
        ))}
        {/* Kintsugi foil riding the lit lip of the dominant veins. */}
        {VEIN_FOIL.map((d) => (
          <Path key={`fl${d}`} d={d} fill="none" stroke={foilInk} strokeWidth={1.1} opacity={0.85} strokeLinecap="round" />
        ))}
        {FOIL_FLECKS.map((f) => (
          <Circle key={`fk${f.cx}-${f.cy}`} cx={f.cx} cy={f.cy} r={f.r} fill={foilInk} opacity={0.85} />
        ))}
        <Rect x={0} y={0} width={320} height={202} fill="url(#marbleLight)" />
        {/* Polished bevel edge. */}
        <Rect
          x={1.25}
          y={1.25}
          width={317.5}
          height={199.5}
          rx={14}
          fill="none"
          stroke={metal.sheen}
          strokeWidth={0.8}
          opacity={0.24}
        />
        {/* Elite hallmark — a gilded double-fillet inlaid just inside the
            slab edge (pietra-dura border), the one embellishment no other
            tier is cut with. Both hairlines sit inside the text gutter. */}
        {elite ? (
          <>
            <Rect
              x={6}
              y={6}
              width={308}
              height={190}
              rx={11}
              fill="none"
              stroke={metal.inkDim}
              strokeWidth={0.7}
              opacity={0.55}
            />
            <Rect
              x={9.5}
              y={9.5}
              width={301}
              height={183}
              rx={9}
              fill="none"
              stroke={metal.inkDim}
              strokeWidth={0.5}
              opacity={0.3}
            />
          </>
        ) : null}
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topRow}>
          <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
          <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
        </View>
        <View style={styles.centerBlock}>
          <FoilInlay metal={metal} />
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
