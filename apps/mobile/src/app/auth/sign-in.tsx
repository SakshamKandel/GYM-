import { AuthScreen } from '../../features/auth/AuthScreen';

/** /auth/sign-in — optional account sign-in (pushed from Settings). */
export default function SignInScreen() {
  return <AuthScreen mode="signIn" />;
}
