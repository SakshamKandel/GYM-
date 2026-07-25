import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';

/**
 * Small Oswald caps tag pill: PR · UP NEXT · CURRENT · MOST POPULAR.
 * Full pill per the block language.
 * - `filled` — solid color (default red) with BLACK label (black-on-red law).
 * - `outline` — 1.5px stroke in `color` (pills/chips may carry strokes).
 * - `dim` — quiet raised-surface pill.
 * - `onBlock` — filled near-black pill for use INSIDE red/cream blocks.
 */
interface Props {
  label: string;
  variant?: 'filled' | 'outline' | 'dim' | 'onBlock';
  color?: string;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    alignSelf: 'flex-start',
  },
});

export function Tag({ label, variant = 'outline', color = colors.accent }: Props) {
  const bg =
    variant === 'filled'
      ? color
      : variant === 'dim'
        ? colors.surfaceRaised
        : variant === 'onBlock'
          ? colors.onBlock
          : 'transparent';
  const textColor =
    variant === 'filled'
      ? colors.onBlock
      : variant === 'dim'
        ? colors.textDim
        : variant === 'onBlock'
          ? colors.text
          : color;
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: bg },
        variant === 'outline' && { borderWidth: 1.5, borderColor: color },
      ]}
    >
      {/* variant="label" is the same 12px Oswald caps this pill hand-rolled,
          but it also picks up the member's text-size setting. */}
      <AppText variant="label" color={textColor} tabular={false} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}
