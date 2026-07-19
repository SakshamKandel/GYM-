import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { cardMetals, radius, spacing, type, type CardMetalTier } from '@gym/ui-tokens';
import type { Tier } from '@gym/shared';
import { PressableScale } from '../../../components/ui';
import { tierExpiryInfo } from '../logic';

/**
 * Membership card — "BLUEPRINT".
 *
 * An engineer's drawing OF the card itself, at 1:1. Every drafting mark is
 * drawn with ONE pen — the tier's `ink` at low opacity — so the linework
 * reads correctly on the light silver/gold faces and the dark starter face.
 * ELITE is the exception: its noir metal swallows the standard plate, so the
 * elite branch lifts every layer's opacity, engraves the mesh/contours with
 * the warm gold `inkDim` pen, and alone earns a gilded double-hairline
 * margin frame on the trim lines. The plate carries: a fine two-weight grid (8pt mesh, 40pt
 * majors) indexed by ruler ticks along the top trim edge; topographic
 * contours climbing to a surveyed summit off the lower-right; a registration
 * target; corner crop marks with trim-dimension arrows measuring the sheet
 * between them (W along the bottom, H up the right edge); and a dash-dot
 * vertical centerline. Member data sits in a hairline cellular TITLE BLOCK
 * along the bottom — MEMBER NO. / SHEET 1/1 / STATUS as spec fields — and
 * the single red accent is a drafting scale bar under the holder name,
 * captioned 85.60 MM (the ISO ID-1 card width, scale 1:1).
 *
 * All geometry is precomputed module constants — no randomness, identical
 * every render. All artwork is local SVG; colors only from cardMetals
 * (rule 7).
 */

const CARD_RATIO = 1.586; // ISO/IEC 7810 ID-1

const TIER_TITLE: Record<Tier, string> = {
  starter: 'MEMBER',
  silver: 'SILVER',
  gold: 'GOLD',
  elite: 'ELITE',
};

/** Fabricated drawing-number spec per tier — the schematic's revision line. */
const TIER_SPEC: Record<Tier, string> = {
  starter: 'DWG GM-001 · REV A',
  silver: 'DWG GM-002 · REV B',
  gold: 'DWG GM-003 · REV C',
  elite: 'DWG GM-004 · REV D',
};

interface Props {
  tier: Tier;
  holderName: string;
  memberId: string | null;
  signedIn: boolean;
  /**
   * Raw ISO `tierExpiresAt` for the current tier (Pack J). When set, the card's
   * status cell becomes a card-style VALID THRU MM/YY (or EXPIRED once past).
   * Omitted / null = no expiry → the classic ACTIVE / LOCAL status. Optional so
   * existing call sites keep compiling until they pass the field.
   */
  expiresAt?: string | null;
  onPress?: () => void;
}

/** MM/YY for the card's VALID THRU cell. Empty string on an unparseable value. */
function shortMonthYear(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${mm}/${yy}`;
}

// ── Precomputed drafting plates (module constants — deterministic) ───────

/** Minor grid every 8pt, skipping the positions the major grid owns. */
const GRID_MINOR_X: readonly number[] = Object.freeze(
  Array.from({ length: 39 }, (_, i) => (i + 1) * 8).filter((x) => x % 40 !== 0),
);
const GRID_MINOR_Y: readonly number[] = Object.freeze(
  Array.from({ length: 24 }, (_, i) => (i + 1) * 8).filter((y) => y % 40 !== 0),
);
/** Major grid every 40pt. */
const GRID_MAJOR_X: readonly number[] = Object.freeze(
  Array.from({ length: 7 }, (_, i) => (i + 1) * 40),
);
const GRID_MAJOR_Y: readonly number[] = Object.freeze(
  Array.from({ length: 4 }, (_, i) => (i + 1) * 40),
);
/** Ruler ticks along the top trim edge, indexing the 8pt grid mesh. */
const RULER_TICKS: readonly number[] = Object.freeze(
  Array.from({ length: 35 }, (_, i) => 24 + i * 8),
);

/**
 * Topographic contours around a "summit" off the bottom-right corner.
 * Each ring is a closed polyline loop sampled once at module load — slightly
 * squashed and rotated so the rings read as terrain, not circles.
 */
function contourRing(cx: number, cy: number, r: number, squash: number, tilt: number): string {
  const parts: string[] = [];
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    // Deterministic wobble from two fixed harmonics — same output every load.
    const wobble = 1 + 0.06 * Math.sin(3 * a + tilt) + 0.04 * Math.cos(5 * a - tilt);
    const x = cx + r * wobble * Math.cos(a + tilt);
    const y = cy + r * squash * wobble * Math.sin(a + tilt);
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}
const CONTOUR_SUMMIT = { x: 300, y: 176 } as const;
const CONTOUR_PATHS: readonly string[] = Object.freeze(
  Array.from({ length: 9 }, (_, i) =>
    contourRing(CONTOUR_SUMMIT.x, CONTOUR_SUMMIT.y, 18 + i * 14, 0.82, 0.5 + i * 0.12),
  ),
);

/**
 * Per-layer opacities for the drafting pen. The elite noir metal is so dark
 * that the standard low-opacity plate vanishes into it, so the `elite` branch
 * lifts every layer (and the component hands the mesh/contour engraving to the
 * warm gold `inkDim` pen). Starter/silver/gold keep the original `standard`
 * values verbatim — do not retune them here.
 */
const DRAFT_OPACITY = {
  standard: {
    gridMinor: 0.055,
    gridMajor: 0.11,
    centerline: 0.09,
    ruler: 0.26,
    contourMajor: 0.14,
    contourMinor: 0.09,
    benchmark: 0.32,
    target: 0.25,
    dims: 0.3,
    crops: 0.45,
  },
  elite: {
    gridMinor: 0.17,
    gridMajor: 0.32,
    centerline: 0.26,
    ruler: 0.5,
    contourMajor: 0.36,
    contourMinor: 0.24,
    benchmark: 0.6,
    target: 0.48,
    dims: 0.55,
    crops: 0.7,
  },
} as const;

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
  /** Tiny drafting annotations — drawing number + scale note under the brand. */
  spec: {
    fontFamily: type.bodyMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  centerBlock: { gap: spacing.sm },
  holder: {
    fontFamily: type.display,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  /** Red drafting scale bar under the name — the face's single accent. */
  scaleWrap: {
    alignSelf: 'flex-start',
    width: 128,
  },
  scaleCaption: {
    fontFamily: type.bodyMedium,
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 1,
  },
  /** Cellular drafting title block — member data as spec fields. */
  titleBlock: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
  },
  tbCell: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  tbCellNarrow: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  tbRule: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  tbLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  tbValue: {
    fontFamily: type.display,
    fontSize: 13,
    letterSpacing: 2,
    marginTop: 1,
  },
});

/**
 * Red-pencil scale bar: |◄────────►| captioned 85.60 MM — the ISO ID-1 card
 * width, confirming the drawing's SCALE 1:1 note. Extension ticks + filled
 * arrowheads, drafting-standard text-above-line.
 */
function ScaleBar({ metal }: { metal: (typeof cardMetals)[CardMetalTier] }) {
  return (
    <View style={styles.scaleWrap}>
      <Text style={[styles.scaleCaption, { color: metal.inkDim }]}>85.60 MM</Text>
      <Svg width={128} height={10} viewBox="0 0 128 10">
        <Line x1={0.8} y1={0} x2={0.8} y2={10} stroke={metal.stripe} strokeWidth={1.2} />
        <Line x1={127.2} y1={0} x2={127.2} y2={10} stroke={metal.stripe} strokeWidth={1.2} />
        <Line x1={2} y1={5} x2={126} y2={5} stroke={metal.stripe} strokeWidth={0.9} />
        <Path d="M2 5 L9 2.4 L9 7.6 Z" fill={metal.stripe} />
        <Path d="M126 5 L119 2.4 L119 7.6 Z" fill={metal.stripe} />
      </Svg>
    </View>
  );
}

export function MembershipCardBlueprint({ tier, holderName, memberId, signedIn, expiresAt, onPress }: Props) {
  const metal = cardMetals[tier];
  const isElite = tier === 'elite';
  const op = DRAFT_OPACITY[isElite ? 'elite' : 'standard'];
  // On elite the engraved mesh + terrain switch to the warm gold inkDim pen so
  // the texture reads on the noir metal; every other tier keeps the ink pen.
  const meshInk = isElite ? metal.inkDim : metal.ink;
  const last4 = memberId ? memberId.replace(/-/g, '').slice(-4).toUpperCase() : '0000';
  const name = (holderName || 'Athlete').trim();
  // Expiry cell (Pack J): only when a real window exists AND the tier is paid
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
          <LinearGradient id="bpMetal" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.5" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.deep} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={320} height={202} fill="url(#bpMetal)" />
        {/* Drafting grid — fine 8pt mesh… */}
        <G stroke={meshInk} strokeWidth={0.35} opacity={op.gridMinor}>
          {GRID_MINOR_X.map((x) => (
            <Line key={`mx${x}`} x1={x} y1={0} x2={x} y2={202} />
          ))}
          {GRID_MINOR_Y.map((y) => (
            <Line key={`my${y}`} x1={0} y1={y} x2={320} y2={y} />
          ))}
        </G>
        {/* …with heavier 40pt majors. */}
        <G stroke={meshInk} strokeWidth={0.55} opacity={op.gridMajor}>
          {GRID_MAJOR_X.map((x) => (
            <Line key={`Mx${x}`} x1={x} y1={0} x2={x} y2={202} />
          ))}
          {GRID_MAJOR_Y.map((y) => (
            <Line key={`My${y}`} x1={0} y1={y} x2={320} y2={y} />
          ))}
        </G>
        {/* Dash-dot vertical centerline through the sheet. */}
        <Line
          x1={160}
          y1={0}
          x2={160}
          y2={202}
          stroke={meshInk}
          strokeWidth={0.6}
          opacity={op.centerline}
          strokeDasharray="14 5 3 5"
        />
        {/* Ruler ticks along the top trim edge — every 8pt, taller on majors. */}
        <G stroke={metal.ink} strokeWidth={0.6} opacity={op.ruler}>
          {RULER_TICKS.map((x) => (
            <Line key={`r${x}`} x1={x} y1={0} x2={x} y2={x % 40 === 0 ? 5.5 : 3} />
          ))}
        </G>
        {/* Topographic contours climbing to a summit off the bottom-right. */}
        <G fill="none" stroke={meshInk}>
          {CONTOUR_PATHS.map((d, i) => (
            <Path
              key={d}
              d={d}
              strokeWidth={i % 3 === 0 ? 0.7 : 0.45}
              opacity={i % 3 === 0 ? op.contourMajor : op.contourMinor}
            />
          ))}
        </G>
        {/* Summit benchmark — the surveyor's triangulation point. */}
        <Circle
          cx={CONTOUR_SUMMIT.x}
          cy={CONTOUR_SUMMIT.y}
          r={2.2}
          fill="none"
          stroke={metal.ink}
          strokeWidth={0.7}
          opacity={op.benchmark}
        />
        <Circle cx={CONTOUR_SUMMIT.x} cy={CONTOUR_SUMMIT.y} r={0.9} fill={metal.ink} opacity={op.benchmark} />
        {/* Registration target, upper-right quadrant — crosshair in a ring. */}
        <G stroke={metal.ink} strokeWidth={0.7} opacity={op.target} fill="none">
          <Circle cx={252} cy={64} r={11} />
          <Line x1={252} y1={48} x2={252} y2={80} />
          <Line x1={236} y1={64} x2={268} y2={64} />
        </G>
        {/* Trim dimensions — W along the bottom, H up the right edge, arrows
            landing on the crop marks' extension lines. */}
        <G stroke={metal.ink} strokeWidth={0.55} opacity={op.dims}>
          <Line x1={313} y1={15} x2={313} y2={187} />
          <Line x1={15} y1={195} x2={305} y2={195} />
        </G>
        <G fill={metal.ink} opacity={op.dims}>
          <Path d="M313 10.5 L311.2 15.2 L314.8 15.2 Z" />
          <Path d="M313 191.5 L311.2 186.8 L314.8 186.8 Z" />
          <Path d="M10.5 195 L15.2 193.2 L15.2 196.8 Z" />
          <Path d="M309.5 195 L304.8 193.2 L304.8 196.8 Z" />
        </G>
        {/* Corner crop marks — the printer's trim ticks. Non-elite sheets stay
            frameless; elite alone earns the gilded margin frame below. */}
        <G stroke={metal.ink} strokeWidth={1} opacity={op.crops}>
          <Line x1={10} y1={4} x2={10} y2={16} />
          <Line x1={4} y1={10} x2={16} y2={10} />
          <Line x1={310} y1={4} x2={310} y2={16} />
          <Line x1={304} y1={10} x2={316} y2={10} />
          <Line x1={10} y1={186} x2={10} y2={198} />
          <Line x1={4} y1={192} x2={16} y2={192} />
          <Line x1={310} y1={186} x2={310} y2={198} />
          <Line x1={304} y1={192} x2={316} y2={192} />
        </G>
        {isElite ? (
          /* ELITE flourish — a gilded double-hairline sheet border, the
             drafting standard's margin frame, drawn with the warm gold pen.
             The outer rule lands exactly on the trim lines the crop marks
             already define; a finer companion rule sits 3.5pt inside. Edge
             linework only — it never crosses the member text. */
          <G fill="none" stroke={metal.inkDim}>
            <Rect x={10} y={10} width={300} height={182} strokeWidth={0.9} opacity={0.6} />
            <Rect x={13.5} y={13.5} width={293} height={175} strokeWidth={0.45} opacity={0.42} />
          </G>
        ) : null}
      </Svg>
      <View style={styles.face} importantForAccessibility="no-hide-descendants" accessible={false}>
        <View>
          <View style={styles.topRow}>
            <Text style={[styles.brand, { color: metal.ink }]}>GM METHOD</Text>
            <Text style={[styles.tierWord, { color: metal.inkDim }]}>{TIER_TITLE[tier]}</Text>
          </View>
          {/* Revision-line annotations — tier drawing number + scale note. */}
          <View style={styles.topRow}>
            <Text style={[styles.spec, { color: metal.inkDim }]}>{TIER_SPEC[tier]}</Text>
            <Text style={[styles.spec, { color: metal.inkDim }]}>SCALE 1:1 · ISO 7810</Text>
          </View>
        </View>
        <View style={styles.centerBlock}>
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
          <ScaleBar metal={metal} />
        </View>
        {/* Title block — member data as spec fields in hairline cells. */}
        <View style={[styles.titleBlock, { borderColor: metal.inkDim }]}>
          <View style={styles.tbCell}>
            <Text style={[styles.tbLabel, { color: metal.inkDim }]} numberOfLines={1}>
              MEMBER NO.
            </Text>
            <Text style={[styles.tbValue, { color: metal.ink }]} numberOfLines={1}>
              •••• {last4}
            </Text>
          </View>
          <View style={[styles.tbRule, { backgroundColor: metal.inkDim }]} />
          <View style={styles.tbCellNarrow}>
            <Text style={[styles.tbLabel, { color: metal.inkDim }]} numberOfLines={1}>
              SHEET
            </Text>
            <Text style={[styles.tbValue, { color: metal.ink }]} numberOfLines={1}>
              1 / 1
            </Text>
          </View>
          <View style={[styles.tbRule, { backgroundColor: metal.inkDim }]} />
          <View style={styles.tbCell}>
            {showExpiry && expiresAt ? (
              <>
                <Text style={[styles.tbLabel, { color: metal.inkDim }]} numberOfLines={1}>
                  {expiry?.expired ? 'EXPIRED' : 'VALID THRU'}
                </Text>
                <Text style={[styles.tbValue, { color: metal.ink }]} numberOfLines={1}>
                  {shortMonthYear(expiresAt)}
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.tbLabel, { color: metal.inkDim }]} numberOfLines={1}>
                  STATUS
                </Text>
                <Text style={[styles.tbValue, { color: metal.ink }]} numberOfLines={1}>
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
