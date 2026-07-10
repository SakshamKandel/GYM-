import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';
import type { ApiErrorCode } from '../../../lib/api/client';

/** Shared pieces for the Google sign-in button (web + native variants). */

export function describeGoogleError(code: ApiErrorCode): string {
  switch (code) {
    case 'not_configured':
      return "Google sign-in isn't switched on yet — use email for now";
    case 'bad_credentials':
      return "Google couldn't verify your account — try again";
    default:
      return "Can't reach the server — check your connection";
  }
}

export function GooglePill({
  onPress,
  disabled,
  busy,
}: {
  onPress: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[googleStyles.pill, (disabled || busy) && googleStyles.pillDisabled]}
    >
      {busy ? (
        <ActivityIndicator color={colors.onBlock} />
      ) : (
        <Ionicons name="logo-google" size={18} color={colors.onBlock} />
      )}
      <AppText style={googleStyles.pillLabel} tabular={false}>
        Continue with Google
      </AppText>
    </PressableScale>
  );
}

// Cream counterpoint pill (REVAMP-BRIEF §2): the screen's single cream
// element, BLACK text/icon on it (`onBlock`), no stroke — fill carries it.
export const googleStyles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  pill: {
    minHeight: touch.primary,
    borderRadius: radius.full,
    backgroundColor: colors.blockCream,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 28,
  },
  pillDisabled: { opacity: 0.4 },
  pillLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    letterSpacing: 0.3,
    color: colors.onBlock,
  },
  centered: { textAlign: 'center' },
});
