import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — CONCEPT B "GUILLOCHÉ RESERVE".
 *
 * Premium through craft, not shine: the reference is a Breguet dial and a
 * banknote intaglio plate. The EMV chip is replaced by an engraved
 * roman-numeral medallion (I / II / III / IV) with its own engine-turned
 * mini-dial, and the whole face is one turned plate built from three ideas:
 *
 *  1. A graded GROUND — concentric hairline rings radiating from a focal
 *     point on the card's right, spacing tightening toward it (density reads
 *     as depth, exactly like a turned watch dial).
 *  2. An epitrochoid-style ROSETTE at that focal point — three interleaved
 *     lattices of circles whose centers ride small rings around the focus,
 *     the classic rose-engine construction: overlapping arcs weave petals.
 *  3. A faint counter-rosette sweeping in from past the top-left corner,
 *     crossing the ground at a slant to raise the true guilloché moiré.
 *
 * A certificate frame (double hairline + corner ticks + pin dots), an
 * intaglio sine micro-line under the brand row with ONE red security thread,
 * and a foil-stamped holder name (sheen catch-light echo) finish the plate.
 *
 * Per-tier ink discipline: light faces (silver/gold) cut their line work in
 * `deep` — dark incisions into bright metal — while the dark starter face
 * engraves in `sheen`. Elite's near-black metal swallows BOTH `sheen` and
 * `deep`, so the flagship plate is gilded instead: every cut is re-inked in
 * the warm `inkDim` gold-beige (light vs shadow cuts separate by opacity,
 * not hue), like gold guilloché on an onyx dial — and elite alone earns a
 * gilded chapter ring around the rosette. The frame/bezel ink follows the
 * same rules so the engraving never dissolves into the ground on any tier.
 *
 * Everything is precomputed module-level constants — no randomness, no
 * per-render math — so the texture is identical on every render and on both
 * platforms. All artwork is local SVG; colors only from cardMetals (rule 7).
 */

const CARD_RATIO = 1.586; // ISO/IEC 7810 ID-1

const TIER_TITLE: Record<Tier, string> = {
  starter: 'MEMBER',
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE',
};

/** Engraved dial numeral per tier — the medallion that replaces the chip. */
const TIER_NUMERAL: Record<Tier, string> = {
  starter: 'I',
  silver: 'II',
  gold: 'III',
  elite: 'IV',
};

/**
 * Per-tier engraving strength + face polarity. `light` scales every
 * light-cut line, `shadow` every shadow-cut line; `lightFace` flips
 * the frame/bezel/tick ink to `deep` on the bright metals (near-white sheen
 * hairlines would vanish on silver and gold) and keeps `sheen` on the dark
 * starter (near-black deep would vanish there). `gilded` — elite only —
 * re-inks every cut, glint and bezel in the warm `inkDim` gold-beige,
 * because elite's near-black metal swallows sheen AND deep alike, and
 * unlocks the elite-exclusive chapter-ring flourish around the rosette.
 */
const PLATE: Record<Tier, { light: number; shadow: number; lightFace: boolean; gilded: boolean }> = {
  starter: { light: 0.12, shadow: 0.16, lightFace: false, gilded: false },
  silver: { light: 0.34, shadow: 0.15, lightFace: true, gilded: false },
  gold: { light: 0.3, shadow: 0.14, lightFace: true, gilded: false },
  elite: { light: 0.3, shadow: 0.2, lightFace: false, gilded: true },
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

// ── Engraving plate — precomputed module constants (deterministic) ────────

/**
 * Focal point of the engine-turned plate: the engraved rosette sits on the
 * card's right (mirroring the reference face's plate-watermark placement) so
 * the holder-name hero on the left stays over quiet ground only.
 */
const ROSETTE = { x: 250, y: 101 } as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Graded ground: concentric rings centered on the rosette. Spacing starts at
 * 3.4u and grows 7.5% per ring — dense at the medallion, relaxing across the
 * face. The farthest card corner is ~270u away, so 285 covers everything.
 */
const GROUND_RADII: readonly number[] = Object.freeze(
  (() => {
    const out: number[] = [];
    let r = 9;
    let step = 3.4;
    while (r < 285) {
      out.push(round2(r));
      r += step;
      step *= 1.075;
    }
    return out;
  })(),
);

/**
 * Counter-rosette from past the top-left corner — uniform rings crossing the
 * graded ground at a slant produce the banknote moiré.
 */
const MOIRE_ORIGIN = { x: -26, y: -20 } as const;
const MOIRE_RADII: readonly number[] = Object.freeze(
  Array.from({ length: 44 }, (_, i) => 34 + i * 9),
);

interface LatticePoint {
  x: number;
  y: number;
}

/**
 * Rose-engine lattice: `count` circle centers riding a ring of radius
 * `ringR` around a focus — every circle drawn from those centers overlaps
 * its neighbours into the petaled rosette a turning lathe cuts.
 */
function latticeCenters(
  focus: { x: number; y: number },
  count: number,
  ringR: number,
  phase: number,
): readonly LatticePoint[] {
  return Object.freeze(
    Array.from({ length: count }, (_, i) => {
      const a = phase + (i / count) * Math.PI * 2;
      return { x: round2(focus.x + ringR * Math.cos(a)), y: round2(focus.y + ringR * Math.sin(a)) };
    }),
  );
}

/** Three interleaved lattice layers, phase-shifted so petals weave. */
const LATTICE_SHADOW = latticeCenters(ROSETTE, 16, 24, 0); // circles r 52 — deep
const LATTICE_LIGHT = latticeCenters(ROSETTE, 16, 40, Math.PI / 16); // circles r 30 — sheen
const LATTICE_HALO = latticeCenters(ROSETTE, 10, 10, Math.PI / 10); // circles r 72 — faint sheen

/** Mini rose-engine dial inside the numeral medallion (36×36 viewBox). */
const MEDALLION_LATTICE = latticeCenters({ x: 18, y: 18 }, 9, 5.5, 0); // circles r 8

/**
 * ELITE-ONLY flourish — a gilded chapter ring encircling the rosette: cream
 * outer hairline, 24 gold minute ticks, gold inner hairline — the minute
 * track of a gold-on-onyx watch dial. Precomputed like every other plate
 * element; rendered only when `PLATE[tier].gilded`.
 */
const ELITE_CHAPTER_R = { outer: 77, tickOuter: 75.5, tickInner: 72.5, inner: 70.5 } as const;
const ELITE_CHAPTER_TICKS: readonly { x1: number; y1: number; x2: number; y2: number }[] =
  Object.freeze(
    Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return {
        x1: round2(ROSETTE.x + ELITE_CHAPTER_R.tickInner * c),
        y1: round2(ROSETTE.y + ELITE_CHAPTER_R.tickInner * s),
        x2: round2(ROSETTE.x + ELITE_CHAPTER_R.tickOuter * c),
        y2: round2(ROSETTE.y + ELITE_CHAPTER_R.tickOuter * s),
      };
    }),
  );

/** Banknote-intaglio sine micro-line, sampled once at module load. */
function sineMicroLine(
  width: number,
  centerY: number,
  amplitude: number,
  wavelength: number,
  phase: number,
): string {
  const parts: string[] = [];
  for (let x = 0; x <= width; x += 2) {
    const y = centerY + amplitude * Math.sin(((x + phase) / wavelength) * Math.PI * 2);
    parts.push(`${x === 0 ? 'M' : 'L'}${x},${y.toFixed(2)}`);
  }
  return parts.join(' ');
}
/** Two interleaved waves (highlight + shadow), phase-shifted half a period. */
const MICRO_LINE_SHEEN = sineMicroLine(280, 4.2, 2, 18, 0);
const MICRO_LINE_DEEP = sineMicroLine(280, 6.6, 1.6, 18, 9);

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
  microLine: {
    width: '100%',
    height: 9,
    marginTop: 2,
  },
  centerBlock: { gap: spacing.md },
  medallion: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  medallionNumeral: {
    fontFamily: type.display,
    fontSize: 14,
    letterSpacing: 1,
  },
  holder: {
    fontFamily: type.display,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  /** Foil catch-light — a sheen copy one point below the ink copy. */
  holderEcho: {
    position: 'absolute',
    top: 1.25,
    left: 0,
    right: 0,
    opacity: 0.6,
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
 * The chip's replacement: an engraved roman-numeral medallion — engine-turned
 * mini-dial, double bezel, chapter-ring ticks (long cardinals, short
 * intercardinals), tier numeral in display caps. Bezel ink follows the face
 * polarity so it engraves on every tier.
 */
function NumeralMedallion({
  tier,
  metal,
}: {
  tier: Tier;
  metal: (typeof cardMetals)[CardMetalTier];
}) {
  const plate = PLATE[tier];
  const bezel = plate.gilded ? metal.inkDim : plate.lightFace ? metal.deep : metal.sheen;
  return (
    <View style={styles.medallion}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 36 36">
        {/* Mini engine-turned dial behind the numeral — same lattice math. */}
        <G fill="none" stroke={bezel} strokeWidth={0.4} opacity={0.28}>
          {MEDALLION_LATTICE.map((p, i) => (
            <Circle key={`md-${i}`} cx={p.x} cy={p.y} r={8} />
          ))}
        </G>
        <Circle cx={18} cy={18} r={16.75} fill="none" stroke={bezel} strokeWidth={1} opacity={0.85} />
        <Circle cx={18} cy={18} r={14} fill="none" stroke={bezel} strokeWidth={0.5} opacity={0.55} />
        {/* Chapter-ring ticks: cardinal long… */}
        <G stroke={bezel} strokeWidth={1} opacity={0.85}>
          <Line x1={18} y1={1.25} x2={18} y2={4} />
          <Line x1={18} y1={32} x2={18} y2={34.75} />
          <Line x1={1.25} y1={18} x2={4} y2={18} />
          <Line x1={32} y1={18} x2={34.75} y2={18} />
        </G>
        {/* …intercardinal short. */}
        <G stroke={bezel} strokeWidth={0.7} opacity={0.5}>
          <Line x1={6.16} y1={6.16} x2={7.53} y2={7.53} />
          <Line x1={29.84} y1={6.16} x2={28.47} y2={7.53} />
          <Line x1={6.16} y1={29.84} x2={7.53} y2={28.47} />
          <Line x1={29.84} y1={29.84} x2={28.47} y2={28.47} />
        </G>
      </Svg>
      <Text style={[styles.medallionNumeral, { color: metal.ink }]}>{TIER_NUMERAL[tier]}</Text>
    </View>
  );
}

export function MembershipCardConceptB({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
  const plate = PLATE[tier];
  // Engraving inks. On the gilded elite plate every line is cut in warm
  // `inkDim` (light vs shadow cuts separate by opacity, not hue) — its
  // near-black metal swallows both `sheen` and `deep`. Every other tier
  // resolves to exactly its previous inks.
  const lineLight = plate.gilded ? metal.inkDim : metal.sheen;
  const lineShadow = plate.gilded ? metal.inkDim : metal.deep;
  const frameInk = plate.gilded ? metal.inkDim : plate.lightFace ? metal.deep : metal.sheen;
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
          <LinearGradient id="gbMetal" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.5" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          <LinearGradient id="gbGlint" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={lineLight} stopOpacity="0" />
            <Stop offset="0.35" stopColor={lineLight} stopOpacity="0.14" />
            <Stop offset="0.5" stopColor={lineLight} stopOpacity="0" />
          </LinearGradient>
          {/* Soft light pooled on the rosette, like a turned dial catching lamp
              light — warm on the gilded elite plate. */}
          <RadialGradient id="gbGlow" cx="0.78" cy="0.5" r="0.55">
            <Stop offset="0" stopColor={lineLight} stopOpacity="0.14" />
            <Stop offset="0.55" stopColor={lineLight} stopOpacity="0.04" />
            <Stop offset="1" stopColor={lineLight} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#gbMetal)" />
        {/* Counter-rosette moiré — the faintest layer, under everything. */}
        <G fill="none" stroke={lineShadow} strokeWidth={0.5} opacity={round2(plate.shadow * 0.45)}>
          {MOIRE_RADII.map((r, i) => (
            <Circle key={`mo-${i}`} cx={MOIRE_ORIGIN.x} cy={MOIRE_ORIGIN.y} r={r} />
          ))}
        </G>
        {/* Graded engine-turned ground — rings tighten toward the medallion. */}
        {GROUND_RADII.map((r, i) => (
          <Circle
            key={`gr-${i}`}
            cx={ROSETTE.x}
            cy={ROSETTE.y}
            r={r}
            fill="none"
            stroke={i % 2 === 0 ? lineLight : lineShadow}
            strokeWidth={0.5}
            opacity={round2((i % 2 === 0 ? plate.light : plate.shadow) * 0.6)}
          />
        ))}
        {/* Rose-engine lattices — halo, then shadow cut, then light cut. */}
        <G fill="none" stroke={lineLight} strokeWidth={0.5} opacity={round2(plate.light * 0.45)}>
          {LATTICE_HALO.map((p, i) => (
            <Circle key={`lh-${i}`} cx={p.x} cy={p.y} r={72} />
          ))}
        </G>
        <G fill="none" stroke={lineShadow} strokeWidth={0.5} opacity={round2(plate.shadow * 0.75)}>
          {LATTICE_SHADOW.map((p, i) => (
            <Circle key={`ls-${i}`} cx={p.x} cy={p.y} r={52} />
          ))}
        </G>
        <G fill="none" stroke={lineLight} strokeWidth={0.55} opacity={round2(plate.light * 0.75)}>
          {LATTICE_LIGHT.map((p, i) => (
            <Circle key={`ll-${i}`} cx={p.x} cy={p.y} r={30} />
          ))}
        </G>
        {/* ELITE-EXCLUSIVE flourish — the gilded chapter ring around the
            rosette: cream outer hairline, gold minute ticks, gold inner
            hairline. No other tier renders this. */}
        {plate.gilded ? (
          <G fill="none">
            <Circle
              cx={ROSETTE.x}
              cy={ROSETTE.y}
              r={ELITE_CHAPTER_R.outer}
              stroke={metal.ink}
              strokeWidth={0.6}
              opacity={0.3}
            />
            <G stroke={metal.inkDim} strokeWidth={0.7} opacity={0.5}>
              {ELITE_CHAPTER_TICKS.map((t, i) => (
                <Line key={`ct-${i}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
              ))}
            </G>
            <Circle
              cx={ROSETTE.x}
              cy={ROSETTE.y}
              r={ELITE_CHAPTER_R.inner}
              stroke={metal.inkDim}
              strokeWidth={0.5}
              opacity={0.35}
            />
          </G>
        ) : null}
        <Rect x={0} y={0} width={320} height={202} fill="url(#gbGlow)" />
        {/* One soft vertical glint. */}
        <Rect x={0} y={0} width={320} height={202} fill="url(#gbGlint)" />
        {/* Certificate frame — double hairline in the face's engraving ink. */}
        <Rect x={5} y={5} width={310} height={192} rx={15} fill="none" stroke={frameInk} strokeWidth={0.7} opacity={0.4} />
        <Rect x={8.5} y={8.5} width={303} height={185} rx={12} fill="none" stroke={frameInk} strokeWidth={0.5} opacity={0.24} />
        {/* Corner flourishes — engraved L-ticks with a pin dot at each elbow. */}
        <G stroke={frameInk} strokeWidth={1} opacity={0.55} fill="none">
          <Path d="M 14 24 L 14 14 L 24 14" />
          <Path d="M 296 14 L 306 14 L 306 24" />
          <Path d="M 14 178 L 14 188 L 24 188" />
          <Path d="M 296 188 L 306 188 L 306 178" />
        </G>
        <G fill={frameInk} opacity={0.55}>
          <Circle cx={14} cy={14} r={1.1} />
          <Circle cx={306} cy={14} r={1.1} />
          <Circle cx={14} cy={188} r={1.1} />
          <Circle cx={306} cy={188} r={1.1} />
        </G>
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View>
          <View style={styles.topRow}>
            <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
            <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
          </View>
          {/* Intaglio micro-line under the brand row + the single red security thread. */}
          <Svg style={styles.microLine} viewBox="0 0 280 12" preserveAspectRatio="none">
            <Path d={MICRO_LINE_DEEP} fill="none" stroke={lineShadow} strokeWidth={0.9} opacity={0.5} />
            <Path d={MICRO_LINE_SHEEN} fill="none" stroke={lineLight} strokeWidth={0.6} opacity={0.45} />
            <Line x1={0} y1={11} x2={280} y2={11} stroke={metal.stripe} strokeWidth={0.7} opacity={0.9} />
          </Svg>
        </View>
        <View style={styles.centerBlock}>
          <NumeralMedallion tier={tier} metal={metal} />
          <View>
            {/* Foil stamp: catch-light below (warm gold on the gilded elite
                plate), ink on top with a deep top-edge shadow. */}
            <Text
              style={[styles.holder, styles.holderEcho, { color: lineLight }]}
              numberOfLines={2}
            >
              {name}
            </Text>
            <Text
              style={[
                styles.holder,
                {
                  color: metal.ink,
                  textShadowColor: metal.deep,
                  textShadowOffset: { width: 0, height: -0.75 },
                  textShadowRadius: 0.75,
                },
              ]}
              numberOfLines={2}
            >
              {name}
            </Text>
          </View>
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
