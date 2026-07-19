import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';
import { cardMetals, colors, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "HOLOGRAPHIC" (iridescent diagonal foil).
 *
 * The reference is a security hologram on a premium card: tilt it and broad
 * diagonal foil bands flash cool cyan → blue, amber → orange, a thin red spark,
 * then back to blue. Here the illusion is layered translucent SVG linear
 * gradients — each band fades in from nothing, blends between two spectral
 * token hues at low opacity, and fades back out — over the tier's own metal
 * plane, all cut by a fine diagonal diffraction grating (hairlines at the same
 * slant) with a few crisp prismatic edge lines where bands meet. Everything is
 * deterministic module geometry: no randomness, identical on every render and
 * platform. Colors come only from cardMetals + the `colors` token palette
 * (rule 7); depth is opacity, never new pigment.
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

// ── Foil geometry (module constants — deterministic) ─────────────────────

/** Horizontal run of every diagonal: top edge sits SLANT px right of bottom. */
const SLANT = 70;

/** One iridescent foil band — a skewed parallelogram blending two spectral hues. */
interface FoilBand {
  /** Top-edge x span (viewBox units; bottom edge sits SLANT left of it). */
  x0: number;
  x1: number;
  /** Entry / exit hues of the blend — token colors only. */
  from: string;
  to: string;
  /** Peak stop opacities BEFORE the per-tier flash multiplier. */
  fromOpacity: number;
  toOpacity: number;
}

/**
 * The spectral sweep, left → right: a wide cool cyan→blue flash, a warm
 * amber→orange flash beside it, a slim red spark off-center-right, and a
 * fainter blue→cyan return at the edge. Widths intentionally uneven — real
 * diffraction never repeats evenly.
 */
const FOIL_BANDS: readonly FoilBand[] = Object.freeze([
  { x0: 34, x1: 118, from: colors.water, to: colors.blue, fromOpacity: 0.2, toOpacity: 0.16 },
  { x0: 118, x1: 152, from: colors.fat, to: colors.orange, fromOpacity: 0.18, toOpacity: 0.13 },
  { x0: 198, x1: 234, from: colors.accent, to: colors.fat, fromOpacity: 0.11, toOpacity: 0.08 },
  { x0: 260, x1: 336, from: colors.blue, to: colors.water, fromOpacity: 0.09, toOpacity: 0.13 },
]);

/** Skewed parallelogram spanning top-edge [x0, x1] (overshoot is clipped by the card). */
function bandPoints(x0: number, x1: number): string {
  return `${x0},0 ${x1},0 ${x1 - SLANT},202 ${x0 - SLANT},202`;
}

/**
 * Crisp prismatic hairlines riding the band boundaries — the fine diffraction
 * "sparkle" where two foil zones meet. Opacity is pre-flash, like the bands.
 */
const PRISM_LINES: readonly { x: number; hue: string; opacity: number }[] = Object.freeze([
  { x: 34, hue: colors.water, opacity: 0.4 },
  { x: 118, hue: colors.fat, opacity: 0.42 },
  { x: 152, hue: colors.orange, opacity: 0.3 },
  { x: 234, hue: colors.accent, opacity: 0.28 },
  { x: 260, hue: colors.blue, opacity: 0.36 },
]);

/**
 * Diffraction grating — fine parallel hairlines at the band slant, covering
 * the whole face (same precomputed-static approach as the brushed face, tilted).
 */
const GRATING_XS: number[] = [];
for (let x = -64; x <= 388; x += 6) GRATING_XS.push(x);

/**
 * Per-tier flash strength. Starter graphite takes the full neon-on-black
 * hologram; sterling silver reads like bright security foil at nearly full
 * strength; warm gold mutes the cool hues hardest so the spectrum sits as an
 * oil-slick sheen instead of paint on 24k. Elite noir is a full step darker
 * than graphite, so the same stop opacities sink into the metal — it
 * over-drives the spectrum (largest product is 0.42 × 1.8 = 0.756, safely ≤ 1)
 * so the flagship actually flashes instead of reading as a plain black slab.
 */
const FLASH: Record<Tier, number> = {
  starter: 1,
  silver: 0.9,
  gold: 0.62,
  elite: 1.8,
};

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

/**
 * Slim metal chip — quiet, engraved (shared face convention). On elite noir
 * the `deep` contact engraving is invisible (near-black on near-black), so the
 * elite chip etches its contacts and outline in the warm inkDim register at
 * reduced opacity instead — same geometry, legible engraving.
 */
function Chip({ metal, elite }: { metal: (typeof cardMetals)[CardMetalTier]; elite: boolean }) {
  const contact = elite ? metal.inkDim : metal.deep;
  const contactOpacity = elite ? 0.5 : 1;
  return (
    <Svg width={34} height={26} viewBox="0 0 34 26">
      <Rect
        x={0.5}
        y={0.5}
        width={33}
        height={25}
        rx={5}
        fill={metal.mid}
        stroke={elite ? metal.inkDim : metal.sheen}
        strokeOpacity={elite ? 0.6 : 1}
        strokeWidth={0.8}
        opacity={0.95}
      />
      <Line x1={0} y1={9} x2={11} y2={9} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={0} y1={17} x2={11} y2={17} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={23} y1={9} x2={34} y2={9} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={23} y1={17} x2={34} y2={17} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={11} y1={2} x2={11} y2={24} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={23} y1={2} x2={23} y2={24} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
    </Svg>
  );
}

export function MembershipCardHolographic({
  tier,
  holderName,
  memberId,
  signedIn,
  expiresAt,
  onPress,
}: Props) {
  const metal = cardMetals[tier];
  const flash = FLASH[tier];
  // Elite noir engraves in the warm ink register: its `deep`/`sheen` strokes
  // are near-black-on-near-black and vanish, so every elite-only branch below
  // swaps them for inkDim/ink at low opacity. Other tiers render unchanged.
  const isElite = tier === 'elite';
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
          {/* Tier metal plane, lit along the same diagonal as the foil. */}
          <LinearGradient id={`holoBase-${tier}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.5" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          {/* One iridescent gradient per band: transparent → hue A → hue B → transparent. */}
          {FOIL_BANDS.map((b, i) => (
            <LinearGradient key={b.x0} id={`holoBand${i}-${tier}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={b.from} stopOpacity={0} />
              <Stop offset="0.32" stopColor={b.from} stopOpacity={b.fromOpacity * flash} />
              <Stop offset="0.68" stopColor={b.to} stopOpacity={b.toOpacity * flash} />
              <Stop offset="1" stopColor={b.to} stopOpacity={0} />
            </LinearGradient>
          ))}
          {/* The metallic glint that rides the hottest part of the spectrum.
              Elite: slate sheen is invisible on noir, so the glint warms to
              inkDim — a faint champagne breath across the seam. */}
          <LinearGradient id={`holoSheen-${tier}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={isElite ? metal.inkDim : metal.sheen} stopOpacity={0} />
            <Stop
              offset="0.5"
              stopColor={isElite ? metal.inkDim : metal.sheen}
              stopOpacity={isElite ? 0.12 : 0.18}
            />
            <Stop offset="1" stopColor={isElite ? metal.inkDim : metal.sheen} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill={`url(#holoBase-${tier})`} />
        {/* Iridescent foil bands — layered translucent diagonal gradients. */}
        {FOIL_BANDS.map((b, i) => (
          <Polygon key={b.x0} points={bandPoints(b.x0, b.x1)} fill={`url(#holoBand${i}-${tier})`} />
        ))}
        {/* Metal glint over the cool→warm seam keeps the face reading as foil. */}
        <Polygon points={bandPoints(88, 176)} fill={`url(#holoSheen-${tier})`} />
        {/* Diffraction grating — fine hairlines at the band slant, full face.
            Elite: sheen/deep hairlines vanish on noir, so the grating etches in
            warm inkDim alternated with sheen at higher opacity instead. */}
        {GRATING_XS.map((x, i) => (
          <Line
            key={x}
            x1={x}
            y1={0}
            x2={x - SLANT}
            y2={202}
            stroke={
              isElite
                ? i % 2 === 0
                  ? metal.inkDim
                  : metal.sheen
                : i % 2 === 0
                  ? metal.sheen
                  : metal.deep
            }
            strokeWidth={0.5}
            opacity={isElite ? (i % 2 === 0 ? 0.12 : 0.16) : i % 2 === 0 ? 0.05 : 0.07}
          />
        ))}
        {/* Prismatic edge lines — crisp spectral sparks where bands meet. */}
        {PRISM_LINES.map((p) => (
          <Line
            key={p.x}
            x1={p.x}
            y1={0}
            x2={p.x - SLANT}
            y2={202}
            stroke={p.hue}
            strokeWidth={0.8}
            opacity={p.opacity * flash}
          />
        ))}
        {/* Hairline inner frame — the machined edge. Elite draws it in warm
            inkDim (sheen is invisible on noir). */}
        <Rect
          x={1.25}
          y={1.25}
          width={317.5}
          height={199.5}
          rx={14}
          fill="none"
          stroke={isElite ? metal.inkDim : metal.sheen}
          strokeWidth={0.8}
          opacity={isElite ? 0.45 : 0.22}
        />
        {/* ELITE FLOURISH — the second hairline of a fine double gold frame:
            a fainter inkDim line inset inside the machined edge, the quiet
            Centurion signature no other tier carries. Edge-only, so it never
            sits under text. */}
        {isElite ? (
          <Rect
            x={4.75}
            y={4.75}
            width={310.5}
            height={192.5}
            rx={11}
            fill="none"
            stroke={metal.inkDim}
            strokeWidth={0.5}
            opacity={0.3}
          />
        ) : null}
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topRow}>
          <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
          <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
        </View>
        <View style={styles.centerBlock}>
          <Chip metal={metal} elite={isElite} />
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
