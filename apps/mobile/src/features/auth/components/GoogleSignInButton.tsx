import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors } from '@gym/ui-tokens';
import { AppText, enterFade } from '../../../components/ui';
import { toApiError } from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';
import { enterApp } from '../nav';
import { describeGoogleError, GoogleLinkPrompt, GooglePill, googleStyles } from './googleShared';
import { NativeGoogleSignIn } from './NativeGoogleSignIn';

/**
 * "Continue with Google".
 * - Native → the platform Google SDK (NativeGoogleSignIn; browser-redirect
 *   flows are blocked by Google for installed apps).
 * - Web → expo-auth-session popup flow (requires a "Web application" OAuth
 *   client with localhost origins registered).
 *
 * Shown ONLY where it can finish (see `googleSignInAvailable`). A button that
 * can only fail is worse than no button: it reads as an offer.
 */

// Closes the auth popup and delivers the result on web; no-op on native.
WebBrowser.maybeCompleteAuthSession();

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

/**
 * Whether "Continue with Google" can actually complete on this platform with
 * what this build was given.
 *
 * Every platform needs the web client id (it's the audience Google signs the
 * identity into, and the only id our server checks). iPhones need a second
 * one: Apple's Google sign-in goes out to Safari and comes back through an
 * app-specific address that only exists when the build carries its own iOS
 * client. Without it the sheet opens and the return trip never lands, so the
 * button is not offered there at all.
 *
 * Exported so the sign-in screen can drop the "or" divider when neither
 * provider button is shown.
 */
export function googleSignInAvailable(): boolean {
  if (!WEB_CLIENT_ID) return false;
  if (Platform.OS === 'ios') return Boolean(IOS_CLIENT_ID);
  return true;
}

/** Web-only flow — safe home for the auth-session hook. */
function WebGoogleButton({ webClientId, returnTo }: { webClientId: string; returnTo?: string }) {
  const signInWithGoogle = useAuth((s) => s.signInWithGoogle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The Google ID token held while the link-password prompt is open (409
  // link_required: the email already has a password account).
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId,
    iosClientId: IOS_CLIENT_ID,
    androidClientId: ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (!response) return;
    if (response.type !== 'success') {
      if (response.type === 'error') setError('Google sign-in was interrupted. Try again');
      return;
    }
    const idToken = response.params['id_token'];
    if (!idToken) {
      setError("Google sign-in didn't finish. Try again");
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    setLinkToken(null);
    signInWithGoogle(idToken)
      .then(() => {
        successHaptic();
        // Shared staff-aware landing — a bare router.replace('/') bounced
        // staff accounts to /welcome ("login did nothing").
        enterApp(returnTo);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        warnHaptic();
        const code = toApiError(err).code;
        if (code === 'link_required') {
          // Same email, existing password account — ask for that password to
          // link Google onto it instead of surfacing an error.
          setLinkToken(idToken);
          return;
        }
        setError(describeGoogleError(code));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [response, signInWithGoogle, returnTo]);

  return (
    <View style={googleStyles.wrap}>
      <GooglePill
        onPress={() => {
          setError(null);
          setLinkToken(null);
          void promptAsync();
        }}
        disabled={request === null}
        busy={busy}
      />
      {error ? (
        <Animated.View entering={enterFade()}>
          <AppText variant="caption" color={colors.error}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
      {linkToken ? (
        <GoogleLinkPrompt
          idToken={linkToken}
          returnTo={returnTo}
          onCancel={() => setLinkToken(null)}
        />
      ) : null}
    </View>
  );
}

export function GoogleSignInButton({ returnTo }: { returnTo?: string }) {
  // Belt and braces with the sign-in screen's own check: this button never
  // renders anywhere it cannot finish.
  if (!WEB_CLIENT_ID || !googleSignInAvailable()) return null;
  if (Platform.OS === 'web') {
    return <WebGoogleButton webClientId={WEB_CLIENT_ID} returnTo={returnTo} />;
  }
  return <NativeGoogleSignIn webClientId={WEB_CLIENT_ID} returnTo={returnTo} />;
}
