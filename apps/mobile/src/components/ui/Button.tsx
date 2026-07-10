import { ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, touch, type } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Pill buttons (REVAMP-BRIEF §2/§6). One primary CTA per screen.
 * - `primary` — solid red pill, BLACK label (black-on-red brand law), 56dp.
 * - `onBlock` — near-black pill with light label, for CTAs sitting INSIDE a
 *   red or cream block.
 * - `secondary` — charcoal pill (`surfaceRaised`), white label, no border.
 * - `ghost` — text only.
 * - `danger` — outlined destructive pill (pills may carry strokes; cards may not).
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onBlock';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.primary,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    flexDirection: 'row',
    gap: 8,
  },
  primary: { backgroundColor: colors.accent },
  onBlock: { backgroundColor: colors.onBlock },
  secondary: { backgroundColor: colors.surfaceRaised },
  ghost: { backgroundColor: 'transparent', minHeight: touch.min },
  danger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  disabled: { opacity: 0.4 },
  labelText: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    letterSpacing: 0.3,
  },
});

const LABEL_COLOR: Record<Variant, string> = {
  primary: colors.onBlock,
  onBlock: colors.text,
  secondary: colors.text,
  ghost: colors.text,
  danger: colors.error,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  accessibilityLabel,
}: Props) {
  const textColor = LABEL_COLOR[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.base, styles[variant], (disabled || loading) && styles.disabled, style]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : null}
      <AppText
        style={[styles.labelText, { color: textColor }]}
        tabular={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}
