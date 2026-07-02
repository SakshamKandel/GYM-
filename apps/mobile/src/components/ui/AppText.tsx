import type { ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { colors, type } from '@gym/ui-tokens';
import { fontScaleMultiplier, useProfile } from '../../state/profile';

/**
 * Typography rules (design reference):
 * - heading/title = Poppins, sentence case, friendly and round
 * - stat/display/label = Oswald condensed — numbers, dates, micro-labels
 * - body = Poppins ≥16px, off-white — never below 16
 * - all numerals tabular so tables and timers never jitter
 */

type Variant =
  | 'label' // 12px Oswald uppercase micro-label
  | 'caption' // 13px dim — units, axis labels only
  | 'body'
  | 'bodyBold'
  | 'title' // 20px Poppins semibold — card & section titles
  | 'heading' // 34px Poppins semibold — screen titles, sentence case
  | 'display' // 40px Oswald
  | 'stat' // 56px Oswald — the numbers users care about
  | 'statHuge'; // 76px Oswald — gym mode / hero

interface Props {
  variant?: Variant;
  color?: string;
  /** Tabular numerals (defaults ON for number-ish variants). */
  tabular?: boolean;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Shrink text to fit one line instead of wrapping (button labels, chips). */
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  children: ReactNode;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: type.display,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  caption: { fontFamily: type.body, fontSize: type.size.caption, color: colors.textDim },
  body: { fontFamily: type.body, fontSize: type.size.body, color: colors.text },
  bodyBold: { fontFamily: type.bodySemiBold, fontSize: type.size.body, color: colors.text },
  title: { fontFamily: type.bodySemiBold, fontSize: type.size.title, color: colors.text },
  heading: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.heading,
    color: colors.text,
    letterSpacing: -0.5,
  },
  display: {
    fontFamily: type.display,
    fontSize: type.size.display,
    color: colors.text,
    letterSpacing: 0.5,
  },
  stat: {
    fontFamily: type.display,
    fontSize: type.size.stat,
    color: colors.text,
    letterSpacing: 0.5,
  },
  statHuge: {
    fontFamily: type.display,
    fontSize: type.size.statHuge,
    color: colors.text,
    letterSpacing: 0.5,
  },
});

const NUMBERISH: Variant[] = ['stat', 'statHuge', 'display'];
const SCALES_WITH_SETTING: Variant[] = ['body', 'bodyBold', 'caption', 'title'];

export function AppText({
  variant = 'body',
  color,
  tabular,
  center,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
  children,
}: Props) {
  const fontScale = useProfile((s) => s.fontScale);
  const base = styles[variant];
  const useTabular = tabular ?? NUMBERISH.includes(variant);
  const scaled = SCALES_WITH_SETTING.includes(variant)
    ? { fontSize: (base.fontSize ?? 16) * fontScaleMultiplier(fontScale) }
    : null;
  return (
    <Text
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
      style={[
        base,
        scaled,
        color ? { color } : null,
        useTabular ? { fontVariant: ['tabular-nums'] } : null,
        center ? { textAlign: 'center' } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}
