import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { colors } from '@gym/ui-tokens';
import { AppText, enterFade } from '../../../components/ui';
import { ApiError, toApiError } from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';
import { enterApp } from '../nav';
import { describeGoogleError, GoogleLinkPrompt, GooglePill, googleStyles } from './googleShared';

/**
 * Native Google sign-in (Android/iOS) via the platform Google SDK — the
 * browser-redirect flow is blocked by Google on installed apps, this is the
 * supported path. Needs the WEB client id (idToken audience) + the Android
 * client (package + SHA-1) registered in the same Google Cloud project.
 * Web builds resolve NativeGoogleSignIn.web.tsx instead of this file.
 */

let configured = false;
function ensureConfigured(webClientId: string): void {
  if (configured) return;
  GoogleSignin.configure({ webClientId, offlineAccess: false });
  configured = true;
}

/**
 * Drop the native Google session so the next "Continue with Google" asks
 * which account instead of silently reusing the last one. Self-configures
 * from the env because sign-out can happen in a fresh app launch where no
 * Google button has mounted yet. Never throws; no-ops when Google sign-in
 * isn't set up in this build. Web builds resolve the stub twin instead.
 */
export async function signOutGoogle(): Promise<void> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) return;
  try {
    ensureConfigured(webClientId);
    await GoogleSignin.signOut();
  } catch {
    // No Google session to drop (or Play Services absent) — fine.
  }
}

/** v13+ returns {type,data}; older versions return the user object directly. */
function extractIdToken(result: unknown): string | null {
  if (result && typeof result === 'object') {
    const r = result as { type?: string; data?: { idToken?: string | null }; idToken?: string | null };
    if (r.type === 'cancelled') return null;
    if (r.data?.idToken) return r.data.idToken;
    if (r.idToken) return r.idToken;
  }
  return null;
}

export function NativeGoogleSignIn({ webClientId }: { webClientId: string }) {
  const signInWithGoogle = useAuth((s) => s.signInWithGoogle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The Google ID token held while the link-password prompt is open (409
  // link_required: the email already has a password account).
  const [linkToken, setLinkToken] = useState<string | null>(null);

  async function press(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    setLinkToken(null);
    let idToken: string | null = null;
    try {
      ensureConfigured(webClientId);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      idToken = extractIdToken(await GoogleSignin.signIn());
      if (!idToken) {
        // User closed the account picker — stay quiet.
        return;
      }
      await signInWithGoogle(idToken);
      successHaptic();
      // Shared staff-aware landing — a bare router.replace('/') bounced
      // staff accounts to /welcome ("login did nothing").
      enterApp();
    } catch (err) {
      warnHaptic();
      // Our own API errors FIRST: ApiError extends Error and carries a `code`
      // property, so the SDK's isErrorWithCode() matches it too — checking the
      // SDK branch first swallowed every server error (link_required included)
      // as "Google setup mismatch" on native.
      if (err instanceof ApiError) {
        if (err.code === 'link_required' && idToken) {
          // Same email, existing password account — ask for that password to
          // link Google onto it instead of surfacing an error.
          setLinkToken(idToken);
          return;
        }
        setError(describeGoogleError(err.code));
        return;
      }
      if (isErrorWithCode(err)) {
        if (err.code === statusCodes.SIGN_IN_CANCELLED) return;
        if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          setError('Google Play services unavailable on this phone');
          return;
        }
        if (err.code === statusCodes.IN_PROGRESS) return;
        // DEVELOPER_ERROR = client ids/SHA-1 mismatch in the Google console.
        setError('Google setup mismatch — check the client ids in the console');
        return;
      }
      setError(describeGoogleError(toApiError(err).code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={googleStyles.wrap}>
      <GooglePill onPress={() => void press()} disabled={false} busy={busy} />
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
