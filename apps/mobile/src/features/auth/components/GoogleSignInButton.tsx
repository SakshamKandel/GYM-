import * as Google from 'expo-auth-session/providers/google';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors } from '@gym/ui-tokens';
import { AppText, enterFade } from '../../../components/ui';
import { toApiError } from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';
import { describeGoogleError, GooglePill, googleStyles } from './googleShared';
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
    signInWithGoogle(idToken)
      .then(() => {
        successHaptic();
        router.replace('/');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        warnHaptic();
        setError(describeGoogleError(toApiError(err).code));
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
