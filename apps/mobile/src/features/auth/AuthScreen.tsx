import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
} from '../../components/ui';
import { toApiError, type ApiErrorCode } from '../../lib/api/client';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import { AuthField } from './components/AuthField';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { replaceStaff, STAFF_ROUTES } from '../staff/nav';
import { replacePath } from './nav';
import { emailError, nameError, newPasswordError, passwordError } from './validation';

/**
 * Shared sign-in / sign-up screen. Accounts are optional — the ghost
 * "Continue without account" exit is always one tap away, and nothing
 * here gates the local-first app.
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
    caption: 'Sign in to sync your progress across devices.',
    submit: 'Sign in',
    switchPrompt: 'New to the GM Method?',
    switchLabel: 'Create account',
    switchPath: '/auth/sign-up',
  },
  signUp: {
    heading: 'Join the GM Method',
    caption: 'One free account for your progress, plans and devices.',
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

/** Human copy for API failures — field-level where the field is known. */
function describeApiError(code: ApiErrorCode): { field: keyof FieldErrors | null; message: string } {
  switch (code) {
    case 'bad_credentials':
      return { field: null, message: "Email or password doesn't match" };
    case 'email_taken':
      return { field: 'email', message: 'This email already has an account' };
    case 'invalid':
      return { field: null, message: 'Check your email and password, then try again' };
    default:
      return { field: null, message: "Can't reach the server — check your connection" };
  }
}

/**
 * Login is the app's front door. Staff members skip the onboarding-gated root
 * and land straight in the staff console; everyone else goes to '/'. The store
 * has already awaited the /api/me/staff probe by the time signIn/signUp
 * resolves, so staffRole is settled here.
 */
function enterApp(): void {
  if (useAuth.getState().staffRole !== null) {
    replaceStaff(STAFF_ROUTES.hub);
    return;
  }
  router.replace('/');
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const signIn = useAuth((s) => s.signIn);
  const signUp = useAuth((s) => s.signUp);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    if (submitting) return;
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
      enterApp();
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
      {router.canGoBack() ? (
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

      <Animated.View entering={enterDown(1)} style={styles.poster}>
        <AppText variant="label">GM Method</AppText>
        <AppText variant="heading">{copy.heading}</AppText>
        <AppText variant="caption">{copy.caption}</AppText>
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.google}>
        <GoogleSignInButton />
        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <AppText variant="caption" color={colors.textFaint}>
            or
          </AppText>
          <View style={styles.orLine} />
        </View>
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

        {formError ? (
          <Animated.View entering={enterFade()}>
            <AppText variant="caption" color={colors.error}>
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
          <AppText variant="caption">{copy.switchPrompt}</AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={copy.switchLabel}
            onPress={() => replacePath(copy.switchPath)}
            style={styles.switchBtn}
          >
            <AppText variant="bodyBold">{copy.switchLabel}</AppText>
          </PressableScale>
        </View>
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
    marginBottom: spacing.xxl,
    gap: spacing.xs,
  },
  google: { gap: spacing.lg, marginBottom: spacing.lg },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  form: { gap: spacing.lg },
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
