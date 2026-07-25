import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { z } from 'zod';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
} from '../../components/ui';
import { BASE_URL, fetchWithTimeout, toApiError, type ApiErrorCode } from '../../lib/api/client';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { resetStackTo } from '../../lib/nav';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { AuthField } from './components/AuthField';
import { GoogleSignInButton, googleSignInAvailable } from './components/GoogleSignInButton';
import { NativeAppleSignIn } from './components/NativeAppleSignIn';
import { enterApp, replacePath } from './nav';
import { emailError, nameError, newPasswordError, passwordError } from './validation';

/**
 * Shared sign-in / sign-up screen. Accounts are optional — an exit is always
 * one tap away (the back arrow when there's somewhere to go back to, the
 * ghost "Continue without account" when this screen opened the app), and
 * nothing here gates the local-first app.
 *
 * Accepts an optional '?returnTo=/some/path' so a screen that asked for
 * sign-in can be reopened right after the account opens.
 */

type Mode = 'signIn' | 'signUp';

interface Copy {
  heading: string;
  caption: string;
  submit: string;
  switchPrompt: string;
  switchLabel: string;
  switchPath: string;
}

const COPY: Record<Mode, Copy> = {
  signIn: {
    heading: 'Welcome back,',
    caption: 'Sign in to keep your progress on every device.',
    submit: 'Sign in',
    switchPrompt: 'New to the GM Method?',
    switchLabel: 'Create account',
    switchPath: '/auth/sign-up',
  },
  signUp: {
    heading: 'Join the GM Method',
    caption: 'One free account for your progress, programs and devices.',
    submit: 'Create account',
    switchPrompt: 'Already have an account?',
    switchLabel: 'Sign in',
    switchPath: '/auth/sign-in',
  },
};

interface FieldErrors {
  name: string | null;
  email: string | null;
  password: string | null;
}

const NO_ERRORS: FieldErrors = { name: null, email: null, password: null };

/**
 * What we may tell the member after asking for a reset link.
 *
 *  - 'accepted'     → the server took it and CAN send email. The only honest
 *                     wording is the conditional one (see the notice below):
 *                     the reply is identical for an address with an account and
 *                     one without, by design, so anything else would turn this
 *                     screen into a way of fishing for members.
 *  - 'noEmailYet'   → this server cannot send email to ANYBODY. Nothing was
 *                     sent and nothing will arrive, so say that rather than
 *                     promising a message.
 *  - 'invalidEmail' → the address isn't a well-formed email. A typo hint, NOT
 *                     "no such account".
 *  - 'failed'       → refused right now (asked too often, or a bad moment).
 *  - 'offline'      → the request never left the phone.
 *  - 'appNotSetUp'  → this build has no address for the account service, so
 *                     nothing was sent and nothing here can work. Blaming
 *                     their connection would be a lie.
 */
type ResetAsk =
  | 'accepted'
  | 'noEmailYet'
  | 'invalidEmail'
  | 'failed'
  | 'offline'
  | 'appNotSetUp';

/**
 * Only `delivery` is read. It describes the SERVER's setup, never the address,
 * so reading it tells us nothing about whether an account exists. `.optional()`
 * because a server from before the field shipped simply omits it.
 */
const resetAckSchema = z.object({
  delivery: z.enum(['sent', 'not_configured']).optional(),
});

/**
 * POST /api/auth/forgot-password — ask for a reset link and find out whether
 * reset-by-email works on this server at all.
 *
 * Unauthenticated by design (someone who can't sign in has no session), and it
 * never throws: every failure comes back as one of the outcomes above, so a
 * wobbly connection can't leave the button stuck on "Sending…".
 */
async function askForResetLink(email: string): Promise<ResetAsk> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
  } catch (err: unknown) {
    return toApiError(err).code === 'app_not_configured' ? 'appNotSetUp' : 'offline';
  }
  if (!res.ok) return res.status === 400 ? 'invalidEmail' : 'failed';
  try {
    const parsed = resetAckSchema.safeParse(await res.json());
    if (parsed.success && parsed.data.delivery === 'not_configured') return 'noEmailYet';
  } catch {
    // Body wasn't readable. It was still accepted, so keep the conditional
    // wording instead of inventing a failure the member can't act on.
  }
  return 'accepted';
}

/** Human copy for API failures — field-level where the field is known. */
function describeApiError(code: ApiErrorCode): { field: keyof FieldErrors | null; message: string } {
  switch (code) {
    case 'bad_credentials':
      return { field: null, message: "Email or password doesn't match" };
    case 'email_taken':
      return { field: 'email', message: 'This email already has an account' };
    case 'invalid':
      return { field: null, message: 'Check your email and password, then try again' };
    case 'app_not_configured':
      // Nothing left the phone, and no amount of retrying will change that.
      return {
        field: null,
        message: "This version of the app can't reach your account. Please update the app",
      };
    default:
      return { field: null, message: "We couldn't connect. Check your connection and try again" };
  }
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const signIn = useAuth((s) => s.signIn);
  const signUp = useAuth((s) => s.signUp);
  const onboarded = useProfile((s) => s.onboarded);
  // Optional '?returnTo=/some/path': the screen the member was headed for when
  // sign-in was asked for. Params can arrive as arrays, so only take a string.
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined;
  // Carry the destination across the sign-in ↔ sign-up switch.
  const switchPath = returnTo
    ? `${copy.switchPath}?returnTo=${encodeURIComponent(returnTo)}`
    : copy.switchPath;
  const canGoBack = router.canGoBack();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetNotice, setResetNotice] = useState<{ text: string; tone: 'dim' | 'error' } | null>(
    null,
  );
  const [sendingReset, setSendingReset] = useState(false);

  // Which provider buttons this build and phone can actually finish with.
  // Google's answer is known immediately; Apple's needs the phone and the
  // account service to agree, so the button reports back when it decides.
  const showGoogle = googleSignInAvailable();
  const [showApple, setShowApple] = useState(false);
  const onAppleAvailability = useCallback((ok: boolean) => setShowApple(ok), []);
  const showProviders = showGoogle || showApple;

  /**
   * "Forgot password?" — ask the server to email a reset link.
   *
   * The server answers identically whether or not the address has an account
   * (no way to fish for members), so this screen must never say anything that
   * implies one exists: on success we only confirm that IF there's an account,
   * instructions are on their way. A failure to reach the server is different
   * — that's about this phone, not the account — so it says so plainly instead
   * of promising an email that was never requested.
   *
   * And when the server tells us it can't send email at all, we say THAT. The
   * screen used to answer "we have sent reset instructions" no matter what,
   * while nothing was ever sent, which left members waiting on a message that
   * was never coming.
   */
  async function handleForgotPassword(): Promise<void> {
    if (sendingReset) return;
    const invalidEmail = emailError(email);
    setErrors((e) => ({ ...e, email: invalidEmail }));
    setFormError(null);
    setResetNotice(null);
    if (invalidEmail) {
      warnHaptic();
      return;
    }

    setSendingReset(true);
    const outcome = await askForResetLink(email);
    setSendingReset(false);
    if (outcome === 'accepted') {
      successHaptic();
      setResetNotice({
        text: 'If that address has an account, we have sent reset instructions.',
        tone: 'dim',
      });
      return;
    }
    warnHaptic();
    if (outcome === 'noEmailYet') {
      // Nothing was sent and nothing will arrive. Point at the one route that
      // still works (an admin can issue a link by hand) instead of leaving the
      // member refreshing an empty inbox.
      setResetNotice({
        text: "Resetting your password by email isn't available yet. Please contact support and we'll get you back into your account.",
        tone: 'error',
      });
    } else if (outcome === 'appNotSetUp') {
      setFormError("This version of the app can't reach your account. Please update the app");
    } else if (outcome === 'offline') {
      setFormError("We couldn't connect. Check your connection and try again");
    } else if (outcome === 'invalidEmail') {
      // The server rejected the address's SHAPE (it never says whether an
      // account exists), so this stays a field-level typo hint.
      setErrors((e) => ({ ...e, email: "That doesn't look like an email" }));
    } else {
      setFormError('Something went wrong. Try again in a moment');
    }
  }

  async function submit(): Promise<void> {
    if (submitting) return;
    setResetNotice(null);
    const next: FieldErrors = {
      name: mode === 'signUp' ? nameError(name) : null,
      email: emailError(email),
      password: mode === 'signUp' ? newPasswordError(password) : passwordError(password),
    };
    setErrors(next);
    setFormError(null);
    if (next.name || next.email || next.password) {
      warnHaptic();
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signUp') await signUp(email, password, name);
      else await signIn(email, password);
      successHaptic();
      enterApp(returnTo);
      return;
    } catch (err) {
      warnHaptic();
      const { field, message } = describeApiError(toApiError(err).code);
      if (field) setErrors((e) => ({ ...e, [field]: message }));
      else setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll keyboardAware>
      {canGoBack ? (
        <Animated.View entering={enterDown(0)} style={styles.headerRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>
      ) : null}

      <View style={styles.poster}>
        <ScreenHeader eyebrow="GM Method" title={copy.heading} />
        <Animated.View entering={enterDown(1)}>
          <AppText variant="body" color={colors.textDim}>
            {copy.caption}
          </AppText>
        </Animated.View>
      </View>

      <Animated.View entering={enterUp(1)} style={showProviders ? styles.providers : null}>
        {/* iPhone only, and NativeAppleSignIn itself stays invisible until
            BOTH the phone and the account service confirm Sign in with Apple
            can finish. Sits above Google because Apple asks for its button to
            be at least as prominent as any other sign-in choice; both are
            provider pills, so the "max 2 primary actions" budget is still
            spent on Sign in / Create account below. */}
        {Platform.OS === 'ios' ? (
          <NativeAppleSignIn returnTo={returnTo} onAvailabilityChange={onAppleAvailability} />
        ) : null}
        {showGoogle ? <GoogleSignInButton returnTo={returnTo} /> : null}
        {/* Fill contrast separates sections — no hairline "or" strokes. The
            divider goes with the buttons: "or" on its own would be nonsense
            when email is the only way in. */}
        {showProviders ? (
          <AppText variant="label" center>
            or
          </AppText>
        ) : null}
      </Animated.View>

      <Animated.View entering={enterUp(2)} style={styles.form}>
        {mode === 'signUp' ? (
          <AuthField
            label="Name"
            error={errors.name}
            value={name}
            onChangeText={setName}
            placeholder="Athlete"
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            maxLength={24}
            returnKeyType="next"
            accessibilityLabel="Your name"
          />
        ) : null}
        <AuthField
          label="Email"
          error={errors.email}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          accessibilityLabel="Email"
        />
        <AuthField
          label="Password"
          error={errors.password}
          secure
          value={password}
          onChangeText={setPassword}
          placeholder={mode === 'signUp' ? 'At least 8 characters' : 'Your password'}
          autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
          textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          accessibilityLabel="Password"
        />

        {/* Recovery lives with the password field, not in the footer — it's
            only useful to someone who just failed at that box. */}
        {mode === 'signIn' ? (
          <View style={styles.forgotRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
              accessibilityHint="Sends password reset instructions to your email"
              onPress={() => void handleForgotPassword()}
              style={styles.forgotBtn}
            >
              <AppText variant="body" color={colors.accent}>
                {sendingReset ? 'Sending…' : 'Forgot password?'}
              </AppText>
            </PressableScale>
          </View>
        ) : null}

        {resetNotice ? (
          <Animated.View entering={enterFade()}>
            <AppText
              variant="body"
              color={resetNotice.tone === 'error' ? colors.error : colors.textDim}
            >
              {resetNotice.text}
            </AppText>
          </Animated.View>
        ) : null}

        {formError ? (
          <Animated.View entering={enterFade()}>
            <AppText variant="body" color={colors.error}>
              {formError}
            </AppText>
          </Animated.View>
        ) : null}

        <Button
          label={copy.submit}
          onPress={() => void submit()}
          loading={submitting}
          style={styles.submit}
        />
      </Animated.View>

      <Animated.View entering={enterUp(3)} style={styles.footer}>
        <View style={styles.switchRow}>
          <AppText variant="body" color={colors.textDim}>
            {copy.switchPrompt}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={copy.switchLabel}
            onPress={() => replacePath(switchPath)}
            style={styles.switchBtn}
          >
            <AppText variant="bodyBold" color={colors.accent}>
              {copy.switchLabel}
            </AppText>
          </PressableScale>
        </View>

        {/* No back arrow above (this screen opened the app), so keep the
            promised exit visible: an account is optional, everything works
            without one. */}
        {canGoBack ? null : (
          <Button
            label="Continue without account"
            variant="ghost"
            onPress={() => resetStackTo(onboarded ? '/' : '/welcome')}
          />
        )}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Screen already supplies 16px of top air — no extra paddingTop here.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poster: {
    // lg (not xl): stacks with Screen's 16px top air when there's no back button.
    marginTop: spacing.lg,
    // 28 of air around the hero header (brief §3).
    marginBottom: spacing.xl + spacing.xs,
    gap: spacing.md,
  },
  // Only applied when at least one provider button is on screen, so an
  // empty provider row leaves no gap above the email fields.
  providers: { gap: spacing.lg, marginBottom: spacing.lg },
  form: { gap: spacing.lg },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // The row itself carries no height — the tappable label below does.
    marginTop: -spacing.sm,
  },
  forgotBtn: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  submit: { marginTop: spacing.sm },
  footer: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  switchBtn: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
});
