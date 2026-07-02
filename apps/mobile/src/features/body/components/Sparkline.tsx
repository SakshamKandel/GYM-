import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors } from '@gym/ui-tokens';

/** 40px inline red sparkline for strength rows. */

interface Props {
  values: number[];
  width?: number;
  height?: number;
}

const INSET = 3;

export function Sparkline({ values, width = 64, height = 40 }: Props) {
  if (values.length === 0) return <View style={{ width, height }} />;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 0.5) {
    min -= 1;
    max += 1;
  }
  const innerW = width - INSET * 2;
  const innerH = height - INSET * 2;
  const y = (v: number): number => INSET + (1 - (v - min) / (max - min)) * innerH;

  if (values.length === 1) {
    const only = values[0] ?? 0;
    return (
      <Svg width={width} height={height}>
        <Circle cx={width / 2} cy={y(only)} r={2.5} fill={colors.accent} />
      </Svg>
    );
  }

  const points = values
    .map((v, i) => `${INSET + (i / (values.length - 1)) * innerW},${y(v)}`)
    .join(' ');

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={colors.accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
