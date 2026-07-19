import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "CARBON WEAVE".
 *
 * Motorsport, not jewellery: the reference is a pre-preg carbon-fiber panel on
 * a race chassis. The whole face is a 2×2 TWILL weave — square tow tiles where
 * every float spans two cells and each row shifts the pattern by one, so the
 * cloth carries the diagonal ribbon that separates twill from a plain
 * checkerboard. Each tile's gradient runs ACROSS its fiber direction
 * (vertical highlight band on warp floats, horizontal on weft) so neighbours
 * catch the light in opposing directions exactly like woven carbon under
 * resin. Over the cloth: exactly ONE sharp red accent — a full-height inlaid
 * pinstripe (metal.stripe) seated in the left margin with a deep-side shadow
 * — a machined datum-target mark instead of a chip, and a single diagonal
 * clear-coat sweep. Matte, sharp, engineered.
 *
 * All geometry is precomputed module-level constants — no randomness, no
 * per-render math — so the texture is identical on every render and on both
 * platforms. All artwork is local SVG; colors only from cardMetals (rule 7):
 * starter reads as graphite weave, silver as silver-carbon, gold as
 * gold-kevlar hybrid, elite as stealth noir cloth shot with warm gold.
 *
 * ELITE visibility (device feedback): elite's near-black metal swallows every
 * sheen-register engraving, so on elite ONLY the weave highlight bands, seam
 * grid, clear-coat sweep and datum-target strokes switch to the warm
 * inkDim/sheen tones at raised opacity — the twill actually reads on the noir
 * panel. Elite also carries its one exclusive embellishment: a fine
 * double-hairline gold inlay frame machined into the outer margin, drawn
 * UNDER the red pinstripe so the single red accent stays continuous. Starter,
 * silver and gold render byte-identically to before.
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

// ── Precomputed weave plate (module constants — deterministic) ────────────

/**
 * Square tow tile, ~14px on screen — small enough to read as cloth, large
 * enough that each float's highlight band survives rasterisation. The
 * viewBox ratio (320:202 ≈ 1.584) matches the card ratio to within 0.1%, so
 * `preserveAspectRatio="none"` keeps the tiles visually square.
 */
const TILE = 13;
const COLS = Math.ceil(320 / TILE); // 25 — last column clipped by the shell
const ROWS = Math.ceil(202 / TILE); // 16 — last row clipped by the shell

interface WeaveTile {
  readonly x: number;
  readonly y: number;
  /** true = warp float (fibers run vertically), false = weft (horizontal). */
  readonly warp: boolean;
}

/**
 * 2×2 twill layout: `(col + row) % 4 < 2` gives every tow a two-cell float
 * and shifts the pattern one cell per row — the classic over-two-under-two
 * diagonal. Computed once at module load.
 */
const WEAVE_TILES: readonly WeaveTile[] = Object.freeze(
  Array.from({ length: COLS * ROWS }, (_, i): WeaveTile => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return { x: col * TILE, y: row * TILE, warp: (col + row) % 4 < 2 };
  }),
);

/** Seam lines between tows — the dark gaps of the weave grid. */
const SEAM_XS: readonly number[] = Object.freeze(
  Array.from({ length: COLS - 1 }, (_, i) => (i + 1) * TILE),
);
const SEAM_YS: readonly number[] = Object.freeze(
  Array.from({ length: ROWS - 1 }, (_, i) => (i + 1) * TILE),
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
 * The chip's replacement: a machined datum-target — two L corner marks
 * framing a crosshair circle, like a reference datum on an engineering
 * drawing. Single engrave tone, no red: the card's single red accent is the
 * pinstripe. `engrave` is metal.sheen on most tiers; elite passes warm
 * inkDim because its near-black metal swallows the sheen entirely.
 */
function DatumTarget({ engrave }: { engrave: string }) {
  return (
    <Svg width={40} height={28} viewBox="0 0 40 28">
      <Path d="M 1 9 L 1 1 L 12 1" fill="none" stroke={engrave} strokeWidth={1.3} opacity={0.85} />
      <Path d="M 39 19 L 39 27 L 28 27" fill="none" stroke={engrave} strokeWidth={1.3} opacity={0.85} />
      <Circle cx={20} cy={14} r={6} fill="none" stroke={engrave} strokeWidth={1.2} opacity={0.9} />
      <Line x1={20} y1={3.5} x2={20} y2={7.5} stroke={engrave} strokeWidth={0.9} opacity={0.6} />
      <Line x1={20} y1={20.5} x2={20} y2={24.5} stroke={engrave} strokeWidth={0.9} opacity={0.6} />
      <Line x1={9.5} y1={14} x2={13.5} y2={14} stroke={engrave} strokeWidth={0.9} opacity={0.6} />
      <Line x1={26.5} y1={14} x2={30.5} y2={14} stroke={engrave} strokeWidth={0.9} opacity={0.6} />
      <Circle cx={20} cy={14} r={1.3} fill={engrave} opacity={0.9} />
    </Svg>
  );
}

export function MembershipCardCarbon({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
  const isElite = tier === 'elite';
  // Elite-only visibility switch: the noir metal swallows sheen-register
  // engraving, so elite renders its weave highlight in the warm inkDim tone at
  // raised opacity, lifts the seam grid onto sheen, and warms the clear coat.
  // Every other tier keeps the exact original values.
  const weaveHi = isElite ? metal.inkDim : metal.sheen;
  const warpPeak = isElite ? 0.3 : 0.18;
  const weftPeak = isElite ? 0.16 : 0.09;
  const seamStroke = isElite ? metal.sheen : metal.deep;
  const seamOpacity = isElite ? 0.5 : 0.3;
  const coatTone = isElite ? metal.inkDim : metal.sheen;
  const coatPeak = isElite ? 0.08 : 0.11;
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
          <LinearGradient id="cfBase" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.55" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
          {/* Warp float — vertical fibers, so the rounded tow catches light in
              a vertical band: the gradient runs ACROSS the fibers. */}
          <LinearGradient id="cfWarp" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={metal.deep} stopOpacity="0.28" />
            <Stop offset="0.5" stopColor={weaveHi} stopOpacity={warpPeak} />
            <Stop offset="1" stopColor={metal.deep} stopOpacity="0.28" />
          </LinearGradient>
          {/* Weft float — horizontal fibers, horizontal highlight band, dimmer
              peak so the two directions alternate in the light. */}
          <LinearGradient id="cfWeft" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={metal.deep} stopOpacity="0.24" />
            <Stop offset="0.5" stopColor={weaveHi} stopOpacity={weftPeak} />
            <Stop offset="1" stopColor={metal.deep} stopOpacity="0.24" />
          </LinearGradient>
          {/* One diagonal clear-coat sweep — resin under studio light. */}
          <LinearGradient id="cfCoat" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={coatTone} stopOpacity="0" />
            <Stop offset="0.38" stopColor={coatTone} stopOpacity={coatPeak} />
            <Stop offset="0.55" stopColor={coatTone} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#cfBase)" />
        {/* 2×2 twill — alternating warp/weft floats on the diagonal shift. */}
        {WEAVE_TILES.map((t) => (
          <Rect
            key={`${t.x}-${t.y}`}
            x={t.x}
            y={t.y}
            width={TILE}
            height={TILE}
            fill={t.warp ? 'url(#cfWarp)' : 'url(#cfWeft)'}
          />
        ))}
        {/* Weave seams — the gaps between tows (dark on lit metals, lifted to
            sheen on elite where deep-on-noir vanishes). */}
        {SEAM_XS.map((x) => (
          <Line key={`sx${x}`} x1={x} y1={0} x2={x} y2={202} stroke={seamStroke} strokeWidth={0.6} opacity={seamOpacity} />
        ))}
        {SEAM_YS.map((y) => (
          <Line key={`sy${y}`} x1={0} y1={y} x2={320} y2={y} stroke={seamStroke} strokeWidth={0.6} opacity={seamOpacity} />
        ))}
        {/* ELITE hallmark — the tier's one exclusive embellishment: a fine
            double-hairline gold inlay frame machined into the outer margin
            (well clear of the 20px content gutter). Drawn UNDER the pinstripe
            so the card's single red accent stays continuous over it. */}
        {isElite ? (
          <>
            <Rect
              x={5.5}
              y={5.5}
              width={309}
              height={191}
              rx={13}
              fill="none"
              stroke={metal.inkDim}
              strokeWidth={0.9}
              opacity={0.55}
            />
            <Rect
              x={8.25}
              y={8.25}
              width={303.5}
              height={185.5}
              rx={11}
              fill="none"
              stroke={metal.inkDim}
              strokeWidth={0.5}
              opacity={0.38}
            />
          </>
        ) : null}
        {/* THE one red accent — a full-height inlaid pinstripe in the left
            margin (clear of the 20px content gutter), seated into the weave
            by a deep shadow hairline on its shaded side. */}
        <Rect x={9.4} y={0} width={2.6} height={202} fill={metal.stripe} opacity={0.96} />
        <Line x1={12.7} y1={0} x2={12.7} y2={202} stroke={metal.deep} strokeWidth={0.7} opacity={0.4} />
        {/* Clear coat over cloth and inlay alike. */}
        <Rect x={0} y={0} width={320} height={202} fill="url(#cfCoat)" />
        {/* Machined panel edge. */}
        <Rect
          x={1.25}
          y={1.25}
          width={317.5}
          height={199.5}
          rx={14}
          fill="none"
          stroke={metal.sheen}
          strokeWidth={0.8}
          opacity={0.2}
        />
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View style={styles.topRow}>
          <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
          <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
        </View>
        <View style={styles.centerBlock}>
          <DatumTarget engrave={isElite ? metal.inkDim : metal.sheen} />
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
