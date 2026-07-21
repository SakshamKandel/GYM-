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
 * Lock screen: minimal and branded — mascot, GYM TRACKER wordmark over the
 * "Locked" heading, one red unlock pill with a fingerprint glyph (or a PIN
 * pad). Content fades in place (no entrance movement).
 */

const MASCOT = require('../../../assets/images/mascot.png');

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
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock GYM Tracker',
        cancelLabel: 'Cancel',
      });
      if (result.success) {
        setLocked(false);
        setShowPinPad(false);
      }
    } finally {
      setPrompting(false);
    }
  }, [prompting]);

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
        setPinError('Wrong PIN — try again.');
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

  return (
    <View style={styles.lock}>
      <Animated.View entering={enterUp(0)} style={styles.lockContent}>
        <Image source={MASCOT} style={styles.mascot} contentFit="contain" />
        <View style={styles.titleBlock}>
          <AppText variant="label">GYM Tracker</AppText>
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
