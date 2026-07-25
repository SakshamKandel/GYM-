/**
 * Web stub — the native Sign in with Apple sheet never enters the web bundle.
 * There is no web Apple flow yet, so this renders nothing at all and the web
 * sign-in screen simply shows Google plus email.
 */
export function NativeAppleSignIn(_props: {
  returnTo?: string;
  /** Kept in step with the native twin; web always reports "not shown". */
  onAvailabilityChange?: (available: boolean) => void;
}) {
  return null;
}
