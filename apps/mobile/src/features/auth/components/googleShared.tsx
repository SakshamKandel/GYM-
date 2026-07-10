import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, Button, enterFade, PressableScale } from '../../../components/ui';
import { toApiError, type ApiErrorCode } from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';
import { enterApp } from '../nav';
import { AuthField } from './AuthField';

/** Shared pieces for the Google sign-in button (web + native variants). */

export function describeGoogleError(code: ApiErrorCode): string {
  switch (code) {
    case 'not_configured':
      return "Google sign-in isn't switched on yet — use email for now";
    case 'bad_credentials':
      return "Google couldn't verify your account — try again";
    case 'link_required':
      return 'This email already has a password account — enter its password to link Google';
    default:
      return "Can't reach the server — check your connection";
  }
}

/**
 * Google ID tokens live ~1 hour. Past this age the server can only answer
 * bad_credentials for an EXPIRED token — indistinguishable from a wrong
 * password — so steer the user back to a fresh "Continue with Google"
 * instead of insisting their correct password doesn't match.
 */
const LINK_TOKEN_STALE_MS = 45 * 60_000;

/**
 * Password-proven Google linking. Shown when /api/auth/google answers 409
 * link_required: the Google email already belongs to a password account, and
 * silently merging would enable account pre-hijacking. Entering the account
 * password once links the Google identity onto that SAME account, so both
 * sign-in methods open identical data from then on.
 */
export function GoogleLinkPrompt({
  idToken,
  onCancel,
}: {
  /** The verified Google ID token that triggered link_required. */
  idToken: string;
  onCancel: () => void;
}) {
  const signInWithGoogle = useAuth((s) => s.signInWithGoogle);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The prompt mounts the moment the 409 arrives, so mount time ≈ token age 0.
  const tokenCapturedAt = useRef(Date.now());

  async function submit(): Promise<void> {
    if (busy) return;
    if (Date.now() - tokenCapturedAt.current > LINK_TOKEN_STALE_MS) {
      warnHaptic();
      setError('Your Google sign-in expired — cancel and tap Continue with Google again');
      return;
    }
    if (!password) {
      warnHaptic();
      setError('Enter your account password to link Google');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(idToken, password);
      successHaptic();
      enterApp();
      // No setBusy(false) on success — enterApp unmounts this screen.
    } catch (err) {
      warnHaptic();
      const code = toApiError(err).code;
      setError(
        code === 'bad_credentials'
          ? "That password doesn't match — try again, or restart with Continue with Google"
          : describeGoogleError(code),
      );
      setBusy(false);
    }
  }

  return (
    <Animated.View entering={enterFade()} style={linkStyles.card}>
      <AppText variant="bodyBold">Link Google to your account</AppText>
      <AppText variant="body" color={colors.textDim}>
        This email already has a password account. Enter its password once to
        connect Google — after that, both sign-ins open the same account and
        the same data.
      </AppText>
      <AuthField
        label="Password"
        error={error}
        secure
        value={password}
        onChangeText={setPassword}
        placeholder="Your account password"
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        accessibilityLabel="Account password"
      />
      <Button label="Link and sign in" onPress={() => void submit()} loading={busy} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Cancel linking Google"
        disabled={busy}
        onPress={onCancel}
        style={linkStyles.cancel}
      >
        <AppText variant="bodyBold" center color={colors.textDim}>
          Cancel
        </AppText>
      </PressableScale>
    </Animated.View>
  );
}

const linkStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cancel: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
});

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
