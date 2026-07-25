import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, Button, enterFade, PressableScale } from '../../../components/ui';
import {
  ApiError,
  requestAppleNonce,
  toApiError,
  type ApiErrorCode,
} from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';
import { enterApp } from '../nav';
import { AuthField } from './AuthField';

/** Shared pieces for the Apple sign-in button (native + web stub variants). */

export function describeAppleError(code: ApiErrorCode): string {
  switch (code) {
    case 'not_configured':
      return "Apple sign-in isn't switched on yet. Use email for now";
    case 'auth_unavailable':
      return "Apple isn't answering right now. Try again in a moment";
    case 'bad_credentials':
      return "Apple couldn't verify your account. Try again";
    case 'link_required':
      return 'This email already has a password account. Enter its password to link Apple';
    case 'app_not_configured':
      // The build itself has no address for the account service, so nothing
      // was sent and their connection is not the problem.
      return "This version of the app can't reach your account. Please update the app";
    default:
      return "We couldn't connect. Check your connection and try again";
  }
}

/**
 * The server only accepts an Apple sign-in for ~10 minutes (both the signed
 * credential and the one-time challenge behind it expire then). Past this age
 * it can only answer "couldn't verify" — indistinguishable from a wrong
 * password — so steer the user back to a fresh "Continue with Apple" instead
 * of insisting their correct password doesn't match.
 */
const LINK_WINDOW_STALE_MS = 8 * 60_000;

// ── Is Apple sign-in actually switched on? ────────────────────
//
// Sign in with Apple needs BOTH halves: the phone has to offer the system
// sheet, AND the account service has to hold this app's Apple id. Without
// the second half every tap comes back "not switched on", so the button used
// to sit there promising something it could never do. Asking for a challenge
// answers that question and hands back the very thing the sign-in needs
// next, so the check costs nothing extra.

/**
 * What we know about the account service's Apple setup:
 *  - 'unknown' → not asked yet, or the phone was offline when we asked. The
 *                button stays visible: a bad moment here is not proof the
 *                feature is missing.
 *  - 'ready'   → it issued a challenge, so the flow can complete.
 *  - 'off'     → it said Apple sign-in isn't switched on. The button stays
 *                hidden for the rest of this app run.
 *
 * Module-level on purpose: the answer describes the service, not the member,
 * so switching between sign-in and sign-up must not ask again.
 */
export type AppleServiceState = 'unknown' | 'ready' | 'off';

let serviceState: AppleServiceState = 'unknown';

/** A challenge the check already collected, reusable once while it's fresh. */
let heldNonce: { value: string; issuedAt: number } | null = null;

/**
 * How long a collected challenge may wait before we ask for a fresh one. Well
 * inside the ~10 minutes the server honours, so the sign-in that uses it
 * always has room to finish.
 */
const HELD_NONCE_FRESH_MS = 2 * 60_000;

/** Ask once whether Apple sign-in can complete against this service. */
export async function checkAppleSignIn(): Promise<AppleServiceState> {
  if (serviceState !== 'unknown') return serviceState;
  try {
    heldNonce = { value: await requestAppleNonce(), issuedAt: Date.now() };
    serviceState = 'ready';
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_configured') serviceState = 'off';
    // Offline, or Apple's own service is having a moment: stay 'unknown' so
    // the next mount asks again rather than hiding a working button.
  }
  return serviceState;
}

/**
 * The challenge for ONE Apple sign-in: the held one while it's fresh,
 * otherwise a new one. Take-once — a challenge is spent by the sign-in that
 * uses it, so it never gets handed out twice.
 */
export async function takeAppleNonce(): Promise<string> {
  const held = heldNonce;
  heldNonce = null;
  if (held !== null && Date.now() - held.issuedAt < HELD_NONCE_FRESH_MS) return held.value;
  try {
    const nonce = await requestAppleNonce();
    serviceState = 'ready';
    return nonce;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_configured') serviceState = 'off';
    throw err;
  }
}

/**
 * Remember that the service turned an Apple sign-in away as not switched on,
 * so the button is gone the next time the screen opens. The current screen
 * keeps it (with the plain-language message underneath) — hiding a control
 * mid-tap would take the explanation with it.
 */
export function noteAppleSignInOff(): void {
  serviceState = 'off';
  heldNonce = null;
}

/** Everything needed to replay the SAME Apple sign-in with a password. */
export interface PendingAppleLink {
  identityToken: string;
  /** The RAW challenge this credential was signed against. */
  nonce: string;
  /** Apple's one-time name, when it supplied one. */
  displayName?: string;
}

/**
 * Password-proven Apple linking. Shown when /api/auth/apple answers 409
 * link_required: the Apple email already belongs to a password account, and
 * silently merging would enable account pre-hijacking. Entering the account
 * password once links the Apple identity onto that SAME account, so both
 * sign-in methods open identical data from then on.
 */
export function AppleLinkPrompt({
  pending,
  returnTo,
  onCancel,
}: {
  /** The verified Apple sign-in that triggered link_required. */
  pending: PendingAppleLink;
  /** Optional screen to reopen once the account is linked and open. */
  returnTo?: string;
  onCancel: () => void;
}) {
  const signInWithApple = useAuth((s) => s.signInWithApple);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The prompt mounts the moment the 409 arrives, so mount time ≈ age 0.
  const capturedAt = useRef(Date.now());

  async function submit(): Promise<void> {
    if (busy) return;
    if (Date.now() - capturedAt.current > LINK_WINDOW_STALE_MS) {
      warnHaptic();
      setError('Your Apple sign-in expired. Cancel and tap Continue with Apple again');
      return;
    }
    if (!password) {
      warnHaptic();
      setError('Enter your account password to link Apple');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithApple(pending.identityToken, pending.nonce, pending.displayName, password);
      successHaptic();
      enterApp(returnTo);
      // No setBusy(false) on success — enterApp unmounts this screen.
    } catch (err) {
      warnHaptic();
      const code = toApiError(err).code;
      setError(
        code === 'bad_credentials'
          ? "That password doesn't match. Try again, or restart with Continue with Apple"
          : describeAppleError(code),
      );
      setBusy(false);
    }
  }

  return (
    <Animated.View entering={enterFade()} style={linkStyles.card}>
      <AppText variant="bodyBold">Link Apple to your account</AppText>
      <AppText variant="body" color={colors.textDim}>
        This email already has a password account. Enter its password once to
        connect Apple. After that, both sign-ins open the same account and the
        same data.
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
        accessibilityLabel="Cancel linking Apple"
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

export function ApplePill({
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
      accessibilityLabel="Continue with Apple"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[appleStyles.pill, (disabled || busy) && appleStyles.pillDisabled]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Ionicons name="logo-apple" size={18} color={colors.text} />
      )}
      <AppText style={appleStyles.pillLabel} tabular={false}>
        Continue with Apple
      </AppText>
    </PressableScale>
  );
}

/**
 * Charcoal twin of the cream Google pill: same geometry, but the near-black
 * fill with white mark keeps Apple's dark button treatment AND leaves the
 * Google pill as the screen's single cream element (REVAMP-BRIEF §2). White
 * ink on `surfaceRaised` clears 4.5:1, and no stroke — fill carries it.
 */
export const appleStyles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  pill: {
    minHeight: touch.primary,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
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
    color: colors.text,
  },
});
