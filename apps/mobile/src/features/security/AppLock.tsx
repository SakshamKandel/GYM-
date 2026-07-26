import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as LocalAuthentication from 'expo-local-authentication';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppStartupScreen } from '../../components/experience/AppStartupScreen';
import { AppText, AppTextInput, PressableScale, enterUp } from '../../components/ui';
import { isAppLockEnabled, useSecurity } from '../../state/security';
import { verifyPin } from './pin';

/**
 * Biometric app lock, with a PIN fallback (Pack P) for devices with no
 * biometric hardware/enrollment. When enabled in Settings, the app locks on
 * cold start and whenever it returns from the background; the fingerprint/
 * face prompt fires automatically (or the PIN pad shows directly when only a
 * PIN is configured), with a manual retry / "Use PIN instead" escape hatch.
 * Web never locks.
 *
 * `lockTimeoutMinutes` (Pack P) gives a grace window after backgrounding
 * where returning to the app skips re-authentication — content is still
 * masked in the app-switcher snapshot regardless (the `locked` flag flips
 * immediately on background either way); the grace window only decides
 * whether returning to `active` re-prompts or auto-clears it.
 *
 * Lock screen: minimal and branded — mascot, THE GM METHOD wordmark over the
 * "Locked" heading, one red unlock pill with a fingerprint glyph (or a PIN
 * pad). Content fades in place (no entrance movement).
 *
 * Never leave a member locked out of their own app. The fingerprint lock can be
 * switched on without a PIN, and biometrics can stop working later (the last
 * fingerprint gets removed, the sensor fails). The OS passcode covers most of
 * that: `disableDeviceFallback` is left at its default of false, so both
 * platforms offer the phone's own passcode once biometrics fail. When even that
 * is unavailable and no PIN was saved here, the lock can never be satisfied
 * again, so it stops protecting anything and only bricks the app. That state is
 * detected from the actual failure and offers one way out.
 */

const MASCOT = require('../../../assets/images/mascot.png');

/**
 * Failures that mean this phone can no longer authenticate AT ALL: biometrics
 * gone or unusable, and no device passcode to fall back to. Anything else (a
 * wrong finger, a cancel, a temporary lockout) is retryable and must NOT open
 * the escape hatch below.
 */
const NO_WAY_IN_ERRORS = new Set(['not_available', 'not_enrolled', 'passcode_not_set']);

/**
 * Plain line for a failed unlock attempt. Null when the member simply dismissed
 * the prompt themselves, which needs no explaining.
 */
function unlockErrorMessage(error: string): string | null {
  if (error === 'user_cancel' || error === 'app_cancel' || error === 'system_cancel') return null;
  if (error === 'lockout') return 'Too many tries. Wait a moment, then try again.';
  if (error === 'authentication_failed') return "That didn't match. Try again.";
  if (NO_WAY_IN_ERRORS.has(error)) return "This phone can't check your fingerprint any more.";
  return "We couldn't check that. Try again.";
}

const styles = StyleSheet.create({
  lock: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  lockContent: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.lg },
  mascot: { width: 120, height: 120, opacity: 0.9 },
  titleBlock: { alignItems: 'center', gap: spacing.xs },
  actionBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  // Primary red pill (same language as ui/Button primary) with an icon slot —
  // composed locally so ui/Button stays untouched.
  unlockBtn: {
    alignSelf: 'stretch',
    minHeight: touch.primary,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: 28,
  },
  unlockBtnBusy: { opacity: 0.7 },
  unlockLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    letterSpacing: 0.3,
    color: colors.onAccent,
  },
  pinInput: {
    alignSelf: 'stretch',
    fontSize: 24,
    letterSpacing: 8,
  },
  // Last-resort block, only rendered when this phone can no longer satisfy the
  // lock. Charcoal, not red — the unlock pill stays the screen's one CTA.
  rescueBlock: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  rescueBtn: {
    alignSelf: 'stretch',
    minHeight: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  rescueLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    color: colors.text,
  },
});

let isSecurityHydrated = false;

export function AppLock({ children }: { children: ReactNode }) {
  const biometricOn = useSecurity((s) => s.biometricLock);
  const pinHash = useSecurity((s) => s.pinHash);
  const enabled = isAppLockEnabled({ biometricLock: biometricOn, pinHash });
  const native = Platform.OS !== 'web';
  const [hydrated, setHydrated] = useState(() => isSecurityHydrated || useSecurity.persist.hasHydrated());
  // Lock BEFORE first paint when the lock could be on — MMKV reads are
  // synchronous, so the persisted preference is already available here. Waiting
  // for the post-paint arm effect would flash a frame of protected content.
  const [locked, setLocked] = useState(
    () => native && isAppLockEnabled(useSecurity.getState()),
  );
  const [prompting, setPrompting] = useState(false);
  /** Plain line under the unlock pill after an attempt that did not let us in. */
  const [authError, setAuthError] = useState<string | null>(null);
  /** Set once an attempt failed in a way this phone can never recover from. */
  const [noWayIn, setNoWayIn] = useState(false);
  // PIN-pad state: shown directly when there's no biometric method to try,
  // or after the member taps "Use PIN instead".
  const [showPinPad, setShowPinPad] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const armed = useRef(false);
  // Mirror `locked` into a ref so the AppState listener (which we don't want to
  // re-subscribe on every lock toggle) always sees the current value.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // Pack P grace timeout: when the app went to the background, so returning
  // within `lockTimeoutMinutes` can skip re-authentication.
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (hydrated) {
      isSecurityHydrated = true;
      return;
    }
    const check = () => {
      if (useSecurity.persist.hasHydrated()) {
        isSecurityHydrated = true;
        setHydrated(true);
      }
    };
    const unsub = useSecurity.persist.onFinishHydration(check);
    check();
    return unsub;
  }, [hydrated]);

  const tryBiometric = useCallback(async () => {
    if (prompting || !useSecurity.getState().biometricLock) return;
    setPrompting(true);
    setAuthError(null);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock The GM Method',
        cancelLabel: 'Cancel',
      });
      if (result.success) {
        setLocked(false);
        setShowPinPad(false);
        setNoWayIn(false);
        return;
      }
      // A failed attempt used to change nothing at all on screen: the button
      // just did nothing, over and over, with no explanation and no way on.
      setAuthError(unlockErrorMessage(result.error));
      if (NO_WAY_IN_ERRORS.has(result.error)) setNoWayIn(true);
    } catch {
      setAuthError("We couldn't check that. Try again.");
    } finally {
      setPrompting(false);
    }
  }, [prompting]);

  /**
   * The escape hatch, and the only place the lock can be switched off from
   * outside Settings. Offered ONLY after an attempt came back saying this phone
   * has no biometrics and no passcode left to fall back on, and only when no
   * PIN was saved here. In that state the lock cannot be satisfied by anyone,
   * so it guards nothing and simply keeps its owner out of their own training.
   */
  function turnOffLock(): void {
    useSecurity.getState().setBiometricLock(false);
    setNoWayIn(false);
    setAuthError(null);
    setLocked(false);
  }

  /** Arm the lock screen: try biometrics first when it's on, else go straight to the PIN pad. */
  const arm = useCallback(() => {
    if (useSecurity.getState().biometricLock) void tryBiometric();
    else if (useSecurity.getState().pinHash !== null) setShowPinPad(true);
  }, [tryBiometric]);

  async function submitPin(): Promise<void> {
    const hash = useSecurity.getState().pinHash;
    if (!hash || prompting) return;
    setPrompting(true);
    setPinError(null);
    try {
      const ok = await verifyPin(pinDraft, hash);
      if (ok) {
        setLocked(false);
        setShowPinPad(false);
        setPinDraft('');
      } else {
        setPinError('Wrong PIN. Try again.');
        setPinDraft('');
      }
    } finally {
      setPrompting(false);
    }
  }

  // Arm the lock once preferences are known (cold start).
  useEffect(() => {
    if (!hydrated || !native || armed.current) return;
    armed.current = true;
    if (enabled) {
      setLocked(true);
      arm();
    }
  }, [hydrated, native, enabled, arm]);

  // Re-lock when the app leaves the foreground and re-prompt when it returns —
  // unless the return falls inside the configured grace window, in which case
  // it unlocks silently (content was still masked during the transition).
  useEffect(() => {
    if (!native) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (!isAppLockEnabled(useSecurity.getState())) return;
      if (state === 'inactive' || state === 'background') {
        backgroundedAtRef.current = Date.now();
        setLocked(true);
      } else if (state === 'active' && lockedRef.current) {
        const timeoutMs = useSecurity.getState().lockTimeoutMinutes * 60_000;
        const elapsed = backgroundedAtRef.current === null ? Infinity : Date.now() - backgroundedAtRef.current;
        if (timeoutMs > 0 && elapsed < timeoutMs) {
          setLocked(false);
        } else {
          arm();
        }
      }
    });
    return () => sub.remove();
  }, [native, arm]);

  if (!native) return <>{children}</>;
  if (!hydrated) return <AppStartupScreen message="Checking app security" />;
  if (!locked) return <>{children}</>;

  const canUsePinInstead = pinHash !== null && biometricOn && !showPinPad;
  // Dead end: this phone can no longer authenticate and nothing was saved here
  // to fall back on. The block below explains it, so the one-line error above
  // would only say the same thing twice.
  const showRescue = noWayIn && pinHash === null;

  return (
    <View style={styles.lock}>
      <Animated.View entering={enterUp(0)} style={styles.lockContent}>
        <Image source={MASCOT} style={styles.mascot} contentFit="contain" />
        <View style={styles.titleBlock}>
          <AppText variant="label">The GM Method</AppText>
          <AppText variant="heading">Locked</AppText>
        </View>
        <View style={styles.actionBlock}>
          {showPinPad ? (
            <>
              <AppTextInput
                value={pinDraft}
                onChangeText={(v) => {
                  setPinDraft(v.replace(/\D/g, '').slice(0, 8));
                  setPinError(null);
                }}
                placeholder="Enter PIN"
                keyboardType="number-pad"
                secureTextEntry
                autoFocus
                textAlign="center"
                maxLength={8}
                onSubmitEditing={() => void submitPin()}
                editable={!prompting}
                accessibilityLabel="Enter your PIN"
                style={styles.pinInput}
              />
              {pinError ? (
                <AppText variant="caption" color={colors.error} center>
                  {pinError}
                </AppText>
              ) : null}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Unlock"
                accessibilityState={{ disabled: prompting || pinDraft.length < 4 }}
                disabled={prompting || pinDraft.length < 4}
                onPress={() => void submitPin()}
                style={[styles.unlockBtn, (prompting || pinDraft.length < 4) && styles.unlockBtnBusy]}
              >
                {prompting ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Ionicons name="keypad" size={18} color={colors.onAccent} />
                )}
                <AppText style={styles.unlockLabel} tabular={false}>
                  {prompting ? 'Checking…' : 'Unlock'}
                </AppText>
              </PressableScale>
              {biometricOn ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Use fingerprint or face unlock instead"
                  onPress={() => {
                    setShowPinPad(false);
                    void tryBiometric();
                  }}
                >
                  <AppText variant="caption" color={colors.accent} center>
                    Use fingerprint instead
                  </AppText>
                </PressableScale>
              ) : null}
            </>
          ) : (
            <>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Unlock"
                accessibilityState={{ disabled: prompting }}
                disabled={prompting}
                onPress={() => void tryBiometric()}
                style={[styles.unlockBtn, prompting && styles.unlockBtnBusy]}
              >
                {prompting ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Ionicons name="finger-print" size={18} color={colors.onAccent} />
                )}
                <AppText style={styles.unlockLabel} tabular={false}>
                  {prompting ? 'Checking…' : 'Unlock'}
                </AppText>
              </PressableScale>
              <AppText variant="caption" color={colors.textFaint} center>
                Fingerprint · Face unlock
              </AppText>
              {authError !== null && !showRescue ? (
                <AppText variant="caption" color={colors.error} center>
                  {authError}
                </AppText>
              ) : null}
              {canUsePinInstead ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Use PIN instead"
                  onPress={() => setShowPinPad(true)}
                >
                  <AppText variant="caption" color={colors.accent} center>
                    Use PIN instead
                  </AppText>
                </PressableScale>
              ) : null}
              {showRescue ? (
                <View style={styles.rescueBlock}>
                  <AppText variant="caption" color={colors.textDim} center>
                    {"Your phone has no fingerprint, face unlock or passcode set up any more, and there's no PIN saved here, so nothing can open the lock. Switch it off to get back to your training."}
                  </AppText>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Turn off app lock"
                    onPress={turnOffLock}
                    style={styles.rescueBtn}
                  >
                    <AppText style={styles.rescueLabel} tabular={false}>
                      Turn off app lock
                    </AppText>
                  </PressableScale>
                </View>
              ) : null}
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

/** Can this device use biometric unlock right now? */
export async function biometricsAvailable(): Promise<
  'ok' | 'no_hardware' | 'not_enrolled'
> {
  if (Platform.OS === 'web') return 'no_hardware';
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return 'no_hardware';
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled ? 'ok' : 'not_enrolled';
}
