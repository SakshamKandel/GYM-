import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors } from '@gym/ui-tokens';
import { AppText, enterFade } from '../../../components/ui';
import { ApiError } from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';
import { enterApp } from '../nav';
import {
  AppleLinkPrompt,
  ApplePill,
  appleStyles,
  checkAppleSignIn,
  describeAppleError,
  noteAppleSignInOff,
  takeAppleNonce,
  type PendingAppleLink,
} from './appleShared';

/**
 * Native "Continue with Apple" (iOS) via the system Sign in with Apple sheet.
 *
 * Renders NOTHING unless BOTH halves are real: the phone offers the system
 * sheet, and the account service holds this app's Apple id (see
 * `checkAppleSignIn`). Older iOS versions, every non-iOS build, and a service
 * that hasn't been given its Apple id simply never see the button. Web builds
 * resolve NativeAppleSignIn.web.tsx instead of this file.
 *
 * Flow: ask OUR server for a one-time challenge, hand that RAW value to the
 * Apple sheet (Apple hashes it into the signed credential itself), then send
 * the credential back with the SAME raw value so the server can prove this
 * sign-in belongs to the challenge it issued.
 */

const SCOPES = [
  AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
  AppleAuthentication.AppleAuthenticationScope.EMAIL,
];

/**
 * Apple hands over the member's name on the FIRST authorization only, in
 * tokenized parts that may each be missing. Anything blank becomes `undefined`
 * so the server falls back to its own naming instead of storing whitespace.
 */
function displayNameFrom(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
): string | undefined {
  if (!fullName) return undefined;
  const name = [fullName.givenName, fullName.familyName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim())
    .join(' ')
    .slice(0, 80)
    .trim();
  return name === '' ? undefined : name;
}

/**
 * The member closed the Apple sheet. Expo raises a coded error for this
 * ('ERR_REQUEST_CANCELED'), and backing out of a sheet is not a failure —
 * stay quiet rather than showing a message for a deliberate choice.
 */
function wasDismissed(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.toUpperCase().includes('CANCEL');
}

export function NativeAppleSignIn({
  returnTo,
  onAvailabilityChange,
}: {
  returnTo?: string;
  /**
   * Told whether this button ends up on screen, so the sign-in screen can
   * drop the "or" divider when no provider button is shown at all.
   */
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const signInWithApple = useAuth((s) => s.signInWithApple);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The verified Apple sign-in held while the link-password prompt is open
  // (409 link_required: the email already has a password account). The server
  // leaves the challenge unspent in that case, so this exact pair can be
  // replayed with the password.
  const [pending, setPending] = useState<PendingAppleLink | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function decide(): Promise<void> {
      // Treat an unreadable answer as "not available" — a hidden button is
      // better than one that can only fail.
      const onThisPhone = await AppleAuthentication.isAvailableAsync().catch(() => false);
      if (cancelled) return;
      if (!onThisPhone) {
        setAvailable(false);
        onAvailabilityChange?.(false);
        return;
      }
      // Second half: the account service has to hold this app's Apple id.
      const service = await checkAppleSignIn();
      if (cancelled) return;
      const ok = service !== 'off';
      setAvailable(ok);
      onAvailabilityChange?.(ok);
    }
    void decide();
    return () => {
      cancelled = true;
    };
  }, [onAvailabilityChange]);

  async function press(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    setPending(null);
    let signedIn: PendingAppleLink | null = null;
    try {
      const nonce = await takeAppleNonce();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: SCOPES,
        // RAW value on purpose: Apple hashes it into the credential, and the
        // server compares against the raw value it issued.
        nonce,
      });
      const identityToken = credential.identityToken;
      if (!identityToken) {
        setError("Apple sign-in didn't finish. Try again");
        return;
      }
      const displayName = displayNameFrom(credential.fullName);
      signedIn = {
        identityToken,
        nonce,
        ...(displayName !== undefined ? { displayName } : null),
      };
      await signInWithApple(signedIn.identityToken, signedIn.nonce, signedIn.displayName);
      successHaptic();
      // Shared staff-aware landing — a bare router.replace('/') bounced staff
      // accounts to /welcome ("login did nothing").
      enterApp(returnTo);
    } catch (err) {
      warnHaptic();
      // Our own API errors FIRST — same ordering trap the Google button hit:
      // ApiError carries a `code` property, so a looser shape check below
      // would swallow every server error (link_required included).
      if (err instanceof ApiError) {
        if (err.code === 'link_required' && signedIn) {
          // Same email, existing password account — ask for that password to
          // link Apple onto it instead of surfacing an error.
          setPending(signedIn);
          return;
        }
        // Switched off after all (or switched off since the screen opened):
        // say so plainly here, and don't offer the button again this run.
        if (err.code === 'not_configured') noteAppleSignInOff();
        setError(describeAppleError(err.code));
        return;
      }
      // Everything else comes from the system sheet, not from us.
      if (wasDismissed(err)) return;
      setError("Apple sign-in didn't finish. Try again");
    } finally {
      setBusy(false);
    }
  }

  if (!available) return null;

  return (
    <View style={appleStyles.wrap}>
      <ApplePill onPress={() => void press()} disabled={false} busy={busy} />
      {error ? (
        <Animated.View entering={enterFade()}>
          <AppText variant="caption" color={colors.error}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
      {pending ? (
        <AppleLinkPrompt
          pending={pending}
          returnTo={returnTo}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </View>
  );
}
