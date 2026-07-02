import { useEffect, useRef, useState } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { AppText } from './AppText';

/**
 * Count-up number: sweeps from the previous value to the new one (~600ms,
 * ease-out). Works everywhere (rAF + state — cheap for the handful of hero
 * numbers that use it). Tabular numerals prevent layout jitter.
 */
interface Props {
  value: number;
  /** Decimal places to render. */
  decimals?: number;
  /** Thousands separator ("12,540"). */
  grouped?: boolean;
  variant?: 'display' | 'stat' | 'statHuge' | 'title' | 'bodyBold';
  color?: string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedNumber({
  value,
  decimals = 0,
  grouped = false,
  variant = 'stat',
  color,
  style,
  duration = 600,
}: Props) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const v = from + (value - from) * easeOut(t);
      setShown(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, duration]);

  const fixed = shown.toFixed(decimals);
  const text = grouped ? Number(fixed).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) : fixed;

  return (
    <AppText variant={variant} color={color} style={style} tabular>
      {text}
    </AppText>
  );
}
