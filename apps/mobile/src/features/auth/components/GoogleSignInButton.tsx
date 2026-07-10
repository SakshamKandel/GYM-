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
 * Env-gated: renders disabled until EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is set.
 */

// Closes the auth popup and delivers the result on web; no-op on native.
WebBrowser.maybeCompleteAuthSession();

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

/** Web-only flow — safe home for the auth-session hook. */
function WebGoogleButton({ webClientId }: { webClientId: string }) {
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
      if (response.type === 'error') setError('Google sign-in was interrupted — try again');
      return;
    }
    const idToken = response.params['id_token'];
    if (!idToken) {
      setError("Google didn't return a sign-in token — try again");
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
        enterApp();
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
  }, [response, signInWithGoogle]);

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
        <GoogleLinkPrompt idToken={linkToken} onCancel={() => setLinkToken(null)} />
      ) : null}
    </View>
  );
}

export function GoogleSignInButton() {
  if (!WEB_CLIENT_ID) {
    return (
      <View style={googleStyles.wrap}>
        <GooglePill onPress={() => undefined} disabled busy={false} />
        <AppText variant="caption" color={colors.textFaint} style={googleStyles.centered}>
          Google sign-in activates once configured
        </AppText>
      </View>
    );
  }
  if (Platform.OS === 'web') {
    return <WebGoogleButton webClientId={WEB_CLIENT_ID} />;
  }
  return <NativeGoogleSignIn webClientId={WEB_CLIENT_ID} />;
}
