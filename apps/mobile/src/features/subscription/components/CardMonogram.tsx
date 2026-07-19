import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "MONOGRAM ATELIER".
 *
 * One idea, executed hard: an oversized engraved initial (the holder's first
 * letter, house "G" when anonymous) pressed INTO the metal and cropped
 * confidently by the bottom and right card edges. The deboss is built from
 * three exact glyph layers — a deep rim shifted up-left (the shadowed wall
 * nearest the light), a sheen rim shifted down-right (the lit far wall), and
 * a near-opaque `mid` body on top — so on the gradient's mid zone the
 * letterform is carried purely by its two chiseled fringes, like a die
 * strike. The traveling glint is drawn ABOVE the letter so light sweeps over
 * the engraving, not under it. Around the letter: editorial restraint — a
 * dotted atelier rule under the letterhead row, a small contact chip
 * top-right, and a label-line bottom block (red eyebrow, tier word, the name
 * set in letterspaced display caps).
 *
 * All geometry is deterministic (fixed offsets, fixed dot positions), all
 * artwork is local SVG or layered Text, and colors come only from cardMetals
 * (rule 7).
 *
 * ELITE (noir) exception: elite's `deep` and `sheen` are charcoal-on-charcoal,
 * so every engraved stroke is re-toned on that tier only — the strike's lit
 * wall, the hairline frame, the dotted rule, the glint and the chip lines all
 * take the warm gold `inkDim` — and the face gains one elite-exclusive
 * flourish: a second inner hairline, forming a fine double gold frame.
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

/**
 * The engraved initial: first Latin letter/digit of the holder's name, house
 * "G" (GM Method) when there is no usable character to strike.
 */
function monogramGlyph(rawName: string): string {
  const match = rawName.trim().match(/[A-Za-z0-9]/);
  return (match?.[0] ?? 'G').toUpperCase();
}

/** Letter size, dp. Anchored past the bottom/right edges so the card crops it. */
const MONOGRAM_SIZE = 210;
/** How far the glyph box sinks below the card's bottom edge (the crop), dp. */
const MONOGRAM_DROP = 64;
/** How far the glyph box bleeds past the right edge, dp. */
const MONOGRAM_BLEED = 8;
/** Deboss rim offsets (dp): shadow wall up-left, lit wall down-right. */
const RIM_SHADOW_SHIFT = -2.5;
const RIM_LIGHT_SHIFT = 3;
/** The letter body — flat `mid`, near-opaque, so the fringes do the drawing. */
const MONOGRAM_BODY_OPACITY = 0.92;

/**
 * Per-tier rim strength. Light faces (silver/gold) are carved by their DEEP
 * fringe — the sheen fringe is near-white on light metal so it runs hot to
 * register. Starter is carved by its SHEEN fringe — its deep fringe is
 * near-black on near-black, so it runs at full pressure just to whisper.
 * Elite re-tones its walls at the render site (shadow wall takes the charcoal
 * `sheen`, lit wall is gilded `inkDim`): on noir metal that swap, not raw
 * pressure, is what makes the strike read.
 */
const DEBOSS_TONE: Record<Tier, { shadow: number; light: number }> = {
  starter: { shadow: 0.9, light: 0.55 },
  silver: { shadow: 0.55, light: 0.9 },
  gold: { shadow: 0.55, light: 0.85 },
  elite: { shadow: 0.95, light: 0.7 },
};

/** Dotted atelier rule under the letterhead row — fixed pitch, deterministic. */
const RULE_DOT_XS: readonly number[] = Object.freeze(
  Array.from({ length: 47 }, (_, i) => 2 + i * 6),
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
  /** Anchors the glyph box past the bottom-right corner; `wrap` crops it. */
  monogramLayer: {
    position: 'absolute',
    right: -MONOGRAM_BLEED,
    bottom: -MONOGRAM_DROP,
  },
  monogram: {
    fontFamily: type.display,
    fontSize: MONOGRAM_SIZE,
    lineHeight: MONOGRAM_SIZE,
    letterSpacing: 0,
    includeFontPadding: false,
  },
  /** Rim copies stack 1:1 on the in-flow body copy (same glyph, same font). */
  monogramRim: {
    position: 'absolute',
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
  dottedRule: {
    width: '100%',
    height: 4,
    marginTop: spacing.xs,
  },
  bottomBlock: {
    gap: spacing.sm,
  },
  /** The single red accent — an eyebrow tick over the label line. */
  accentLine: {
    width: 30,
    height: 2,
    borderRadius: 1,
  },
  tierWord: {
    fontFamily: type.bodySemiBold,
    fontSize: 13,
    letterSpacing: 3,
  },
  /** Label line: the name in letterspaced display caps, one line, never wraps. */
  holder: {
    fontFamily: type.display,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.xs,
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
 * Small contact chip, top-right — reference geometry scaled to the corner.
 * `gilded` (elite only): deep contact lines and the sheen outline vanish on
 * noir mid-metal, so both are re-toned to the warm `inkDim` at reduced
 * pressure — a gold-contact chip. Other tiers render exactly as before.
 */
function CornerChip({ metal, gilded }: { metal: (typeof cardMetals)[CardMetalTier]; gilded: boolean }) {
  const edge = gilded ? metal.inkDim : metal.sheen;
  const contact = gilded ? metal.inkDim : metal.deep;
  const contactOpacity = gilded ? 0.62 : 1;
  return (
    <Svg width={32} height={24} viewBox="0 0 32 24">
      <Rect x={0.5} y={0.5} width={31} height={23} rx={5} fill={metal.mid} stroke={edge} strokeWidth={0.8} opacity={0.95} />
      <Line x1={0} y1={8.5} x2={10.5} y2={8.5} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={0} y1={15.5} x2={10.5} y2={15.5} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={21.5} y1={8.5} x2={32} y2={8.5} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={21.5} y1={15.5} x2={32} y2={15.5} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={10.5} y1={2} x2={10.5} y2={22} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
      <Line x1={21.5} y1={2} x2={21.5} y2={22} stroke={contact} strokeWidth={1} opacity={contactOpacity} />
    </Svg>
  );
}

export function MembershipCardMonogram({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
  const tone = DEBOSS_TONE[tier];
  const isElite = tier === 'elite';
  // Elite noir re-tone (see DEBOSS_TONE doc): the shadow wall takes the
  // charcoal `sheen` (deep is invisible on near-black) and the lit wall is
  // gilded warm `inkDim`; every engraved hairline (`etch`) follows the lit
  // wall. Starter/silver/gold keep the stock deep/sheen strokes untouched.
  const rimShadow = isElite ? metal.sheen : metal.deep;
  const rimLight = isElite ? metal.inkDim : metal.sheen;
  const etch = isElite ? metal.inkDim : metal.sheen;
  const last4 = memberId ? memberId.replace(/-/g, '').slice(-4).toUpperCase() : '0000';
  const name = (holderName || 'Athlete').trim();
  const initial = monogramGlyph(holderName);
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
          <LinearGradient id="monogramMetal" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.5" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#monogramMetal)" />
        {/* Hairline inner frame — the machined edge. The letter crosses it. */}
        <Rect
          x={1.25}
          y={1.25}
          width={317.5}
          height={199.5}
          rx={14}
          fill="none"
          stroke={etch}
          strokeWidth={0.8}
          opacity={isElite ? 0.34 : 0.22}
        />
        {/* ELITE-ONLY flourish: a second, inset hairline — with the gilded
            outer rule it forms a fine double gold frame (Centurion register,
            border-band only, never under text). */}
        {isElite ? (
          <Rect
            x={4.75}
            y={4.75}
            width={310.5}
            height={192.5}
            rx={11}
            fill="none"
            stroke={metal.inkDim}
            strokeWidth={0.6}
            opacity={0.26}
          />
        ) : null}
      </Svg>
      {/* The struck initial — shadow rim up-left, lit rim down-right, flat
          `mid` body on top. Decorative artwork: fixed geometry, no font scale. */}
      <View
        style={styles.monogramLayer}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          allowFontScaling={false}
          style={[
            styles.monogram,
            styles.monogramRim,
            { top: RIM_SHADOW_SHIFT, left: RIM_SHADOW_SHIFT, color: rimShadow, opacity: tone.shadow },
          ]}
        >
          {initial}
        </Text>
        <Text
          allowFontScaling={false}
          style={[
            styles.monogram,
            styles.monogramRim,
            { top: RIM_LIGHT_SHIFT, left: RIM_LIGHT_SHIFT, color: rimLight, opacity: tone.light },
          ]}
        >
          {initial}
        </Text>
        <Text
          allowFontScaling={false}
          style={[styles.monogram, { color: metal.mid, opacity: MONOGRAM_BODY_OPACITY }]}
        >
          {initial}
        </Text>
      </View>
      {/* Glint ABOVE the letter — light sweeping over an engraved surface. */}
      <Svg style={styles.svg} viewBox="0 0 320 202" preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <LinearGradient id="monogramGlint" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={etch} stopOpacity="0" />
            <Stop offset="0.4" stopColor={etch} stopOpacity={isElite ? 0.09 : 0.12} />
            <Stop offset="0.55" stopColor={etch} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#monogramGlint)" />
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View>
          <View style={styles.topRow}>
            <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
            <CornerChip metal={metal} gilded={isElite} />
          </View>
          {/* Atelier dotted rule — the only ornament above the letter. */}
          <Svg style={styles.dottedRule} viewBox="0 0 280 4" preserveAspectRatio="none">
            {RULE_DOT_XS.map((x) => (
              <Rect key={x} x={x} y={1.4} width={1.4} height={1.4} fill={etch} opacity={isElite ? 0.5 : 0.4} />
            ))}
          </Svg>
        </View>
        <View style={styles.bottomBlock}>
          <View style={[styles.accentLine, { backgroundColor: metal.stripe }]} />
          <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
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
            numberOfLines={1}
          >
            {name}
          </Text>
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
