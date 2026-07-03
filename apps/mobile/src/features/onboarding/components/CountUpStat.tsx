import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { colors } from '@gym/ui-tokens';
import { AnimatedNumber, AppText } from '../../../components/ui';

/**
 * StatBlock-shaped hero number that counts UP to its value on mount — the
 * "here's your plan" reveal at the end of onboarding. Same count-up vocabulary
 * as the streak sheet (Oswald sweep). Reduced motion: lands on the value at
 * once. Passive content, so nothing slides — only the digits settle.
 */
interface Props {
  label: string;
  value: number;
  unit?: string;
  accent?: boolean;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
});

export function CountUpStat({ label, value, unit, accent = false }: Props) {
  const reduceMotion = useReducedMotion();
  // Start at zero and sweep up once the block is on screen (rAF defers the
  // change one frame so AnimatedNumber sees 0 → value and counts).
  const [shown, setShown] = useState(reduceMotion ? value : 0);
  useEffect(() => {
    if (reduceMotion) {
      setShown(value);
      return undefined;
    }
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value, reduceMotion]);

  const color = accent ? colors.accent : colors.text;
  return (
    <View
      accessible
      accessibilityLabel={unit ? `${label}: ${value} ${unit}` : `${label}: ${value}`}
    >
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.row}>
        <AnimatedNumber value={shown} variant="stat" color={color} />
        {unit ? (
          <AppText variant="caption" color={colors.textDim}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
