import type { ComponentType } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { colors } from '@gym/ui-tokens';

/**
 * EmptyArt — small code-drawn SVG illustrations for empty states, replacing
 * the muted icon-in-a-square with a friendlier scene while staying inside the
 * design laws: flat token fills only (no gradients, no new hex), no motion,
 * purely decorative (hidden from accessibility — the EmptyState title/body
 * carry the meaning).
 *
 * Every variant sits on the same backdrop — a raised disc with a red spark
 * and a faint ring — so the set reads as one family across screens.
 */

export type EmptyArtVariant = 'train' | 'food' | 'history' | 'coach' | 'invite' | 'body';

interface Props {
  variant: EmptyArtVariant;
  /** Rendered width; height keeps the 120:100 canvas ratio. Default 120. */
  width?: number;
}

/** Shared backdrop: raised disc + red spark + faint outline ring. */
function Backdrop() {
  return (
    <>
      <Circle cx={60} cy={52} r={44} fill={colors.surfaceRaised} />
      <Circle cx={102} cy={18} r={5} fill={colors.accent} />
      <Circle cx={18} cy={80} r={8} fill="none" stroke={colors.borderStrong} strokeWidth={2} />
    </>
  );
}

/** Tilted barbell: red inner plates, quiet outer plates. */
function TrainArt() {
  return (
    <G rotation={-12} origin="60,52">
      <Rect x={18} y={48} width={84} height={8} rx={4} fill={colors.textDim} />
      <Rect x={30} y={34} width={9} height={36} rx={3} fill={colors.accent} />
      <Rect x={81} y={34} width={9} height={36} rx={3} fill={colors.accent} />
      <Rect x={21} y={40} width={7} height={24} rx={3} fill={colors.textFaint} />
      <Rect x={92} y={40} width={7} height={24} rx={3} fill={colors.textFaint} />
    </G>
  );
}

/** Plate with a red bite of food and a fork alongside. */
function FoodArt() {
  return (
    <>
      <Circle cx={68} cy={52} r={26} fill={colors.surface} />
      <Circle cx={68} cy={52} r={16} fill={colors.bg} />
      <Circle cx={68} cy={52} r={8} fill={colors.accent} />
      {/* Fork: three tines over a rounded handle. */}
      <Rect x={27} y={28} width={3.5} height={13} rx={1.75} fill={colors.textDim} />
      <Rect x={33} y={28} width={3.5} height={13} rx={1.75} fill={colors.textDim} />
      <Rect x={39} y={28} width={3.5} height={13} rx={1.75} fill={colors.textDim} />
      <Rect x={32.5} y={38} width={5} height={34} rx={2.5} fill={colors.textDim} />
    </>
  );
}

/** Calendar sheet with a red "today" dot. */
function HistoryArt() {
  return (
    <>
      <Rect x={32} y={32} width={56} height={46} rx={10} fill={colors.surface} />
      <Rect x={32} y={32} width={56} height={16} rx={8} fill={colors.accent} />
      <Rect x={32} y={40} width={56} height={8} fill={colors.accent} />
      <Rect x={44} y={26} width={4} height={12} rx={2} fill={colors.textDim} />
      <Rect x={72} y={26} width={4} height={12} rx={2} fill={colors.textDim} />
      <Circle cx={46} cy={58} r={3} fill={colors.textFaint} />
      <Circle cx={60} cy={58} r={3} fill={colors.textFaint} />
      <Circle cx={74} cy={58} r={3} fill={colors.textFaint} />
      <Circle cx={46} cy={69} r={3} fill={colors.textFaint} />
      <Circle cx={60} cy={69} r={3} fill={colors.textFaint} />
      <Circle cx={74} cy={69} r={4} fill={colors.accent} />
    </>
  );
}

/** Coach's medal on a ribbon. */
function CoachArt() {
  return (
    <>
      <Rect x={51} y={18} width={8} height={28} rx={2} fill={colors.accentDim} rotation={-16} origin="55,32" />
      <Rect x={61} y={18} width={8} height={28} rx={2} fill={colors.accentDim} rotation={16} origin="65,32" />
      <Circle cx={60} cy={58} r={18} fill={colors.accent} />
      <Circle cx={60} cy={58} r={12} fill={colors.surfaceRaised} />
      <Circle cx={60} cy={58} r={5} fill={colors.accent} />
    </>
  );
}

/** Envelope with a red opened flap and a plus spark. */
function InviteArt() {
  return (
    <>
      <Rect x={30} y={38} width={54} height={36} rx={8} fill={colors.surface} />
      <Path
        d="M33 43 L57 60 L81 43"
        fill="none"
        stroke={colors.accent}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x={92} y={54} width={4} height={16} rx={2} fill={colors.textDim} />
      <Rect x={86} y={60} width={16} height={4} rx={2} fill={colors.textDim} />
    </>
  );
}

/** Bathroom scale with a red gauge needle — the "log your weight" scene. */
function BodyArt() {
  return (
    <>
      {/* Scale body + feet. */}
      <Rect x={36} y={42} width={48} height={30} rx={9} fill={colors.surface} />
      <Rect x={44} y={69} width={6} height={7} rx={2} fill={colors.textFaint} />
      <Rect x={70} y={69} width={6} height={7} rx={2} fill={colors.textFaint} />
      {/* Gauge window with a red needle sweeping up. */}
      <Circle cx={60} cy={55} r={10} fill={colors.bg} />
      <Circle cx={60} cy={55} r={10} fill="none" stroke={colors.borderStrong} strokeWidth={1.5} />
      <Path d="M60 55 L67 49" stroke={colors.accent} strokeWidth={2.5} strokeLinecap="round" />
      <Circle cx={60} cy={55} r={2} fill={colors.accent} />
    </>
  );
}

const ART: Record<EmptyArtVariant, ComponentType> = {
  train: TrainArt,
  food: FoodArt,
  history: HistoryArt,
  coach: CoachArt,
  invite: InviteArt,
  body: BodyArt,
};

export function EmptyArt({ variant, width = 120 }: Props) {
  const Scene = ART[variant];
  const height = Math.round((width * 100) / 120);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width={width} height={height} viewBox="0 0 120 100">
        <Backdrop />
        <Scene />
      </Svg>
    </View>
  );
}
