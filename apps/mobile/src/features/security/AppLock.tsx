import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as LocalAuthentication from 'expo-local-authentication';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppStartupScreen } from '../../components/experience/AppStartupScreen';
import { AppText, PressableScale, enterUp } from '../../components/ui';
import { useSecurity } from '../../state/security';

/**
 * Biometric app lock. When enabled in Settings, the app locks on cold start
 * and whenever it returns from the background; the fingerprint/face prompt
 * fires automatically, with a manual retry button. Web never locks.
 *
 * Lock screen: minimal and branded — mascot, GYM TRACKER wordmark over the
 * "Locked" heading, one red unlock pill with a fingerprint glyph. Content
 * fades in place (no entrance movement).
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
});

export function AppLock({ children }: { children: ReactNode }) {
  const enabled = useSecurity((s) => s.biometricLock);
  const native = Platform.OS !== 'web';
  const [hydrated, setHydrated] = useState(() => useSecurity.persist.hasHydrated());
  // Lock BEFORE first paint when the lock could be on — MMKV reads are
  // synchronous, so the persisted preference is already available here. Waiting
  // for the post-paint arm effect would flash a frame of protected content.
  const [locked, setLocked] = useState(() => native && useSecurity.getState().biometricLock);
  const [prompting, setPrompting] = useState(false);
  const armed = useRef(false);
  // Mirror `locked` into a ref so the AppState listener (which we don't want to
  // re-subscribe on every lock toggle) always sees the current value.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (hydrated) return;
    const unsub = useSecurity.persist.onFinishHydration(() => setHydrated(true));
    if (useSecurity.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);

  const tryUnlock = useCallback(async () => {
    if (prompting) return;
    setPrompting(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock GYM Tracker',
        cancelLabel: 'Cancel',
      });
      if (result.success) setLocked(false);
    } finally {
      setPrompting(false);
    }
  }, [prompting]);

  // Arm the lock once preferences are known (cold start).
  useEffect(() => {
    if (!hydrated || !native || armed.current) return;
    armed.current = true;
    if (enabled) {
      setLocked(true);
      void tryUnlock();
    }
  }, [hydrated, native, enabled, tryUnlock]);

  // Re-lock when the app leaves the foreground and re-prompt when it returns.
  // 'inactive' (not just 'background') covers the app-switcher snapshot so the
  // unlocked content is masked there; 'active' auto-fires the biometric prompt.
  useEffect(() => {
    if (!native) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (!useSecurity.getState().biometricLock) return;
      if (state === 'inactive' || state === 'background') {
        setLocked(true);
      } else if (state === 'active' && lockedRef.current) {
        void tryUnlock();
      }
    });
    return () => sub.remove();
  }, [native, tryUnlock]);

  if (!native) return <>{children}</>;
  if (!hydrated) return <AppStartupScreen message="Checking app security" />;
  if (!locked) return <>{children}</>;

  return (
    <View style={styles.lock}>
      <Animated.View entering={enterUp(0)} style={styles.lockContent}>
        <Image source={MASCOT} style={styles.mascot} contentFit="contain" />
        <View style={styles.titleBlock}>
          <AppText variant="label">GYM Tracker</AppText>
          <AppText variant="heading">Locked</AppText>
        </View>
        <View style={styles.actionBlock}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Unlock"
            accessibilityState={{ disabled: prompting }}
            disabled={prompting}
            onPress={() => void tryUnlock()}
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
