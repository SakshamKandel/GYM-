/**
 * Web stub — the native Google SDK never enters the web bundle. The web
 * flow lives in GoogleSignInButton via expo-auth-session.
 */
export function NativeGoogleSignIn(_props: { webClientId: string }) {
  return null;
}

/**
 * Stub twin of the native signOutGoogle. The web flow's Google session
 * lives in the browser's Google cookies, which the app cannot clear.
 */
export async function signOutGoogle(): Promise<void> {
  // Nothing to do on web.
}
