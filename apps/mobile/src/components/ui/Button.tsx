import { ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, touch, type } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Primary = solid red pill, white semibold label, 56dp tall.
 * Secondary = 1px outlined pill. Ghost = text only.
 * Red is reserved for "the action to take now" — one primary per view.
 */

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
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
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
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

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  accessibilityLabel,
}: Props) {
  const textColor =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'danger'
        ? colors.error
        : colors.text;
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
