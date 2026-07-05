import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { colors, radius, touch } from '@gym/ui-tokens';
import { ConfirmDialog, PressableScale } from '../../components/ui';
import { successHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';

/**
 * Shared exit controls for the mobile staff console — one place that owns BOTH
 * "leave the console" affordances so the coach hub, coach dashboard and admin
 * home behave identically.
 *
 * Two distinct actions, deliberately kept separate:
 *  • Switch to member app — STAY signed in, just leave the console for the
 *    normal athlete experience. Routes to the member root `/`.
 *  • Sign out — drop the whole session (member + staff) behind a confirm.
 *
 * Routing target — why always `router.replace('/')`:
 *   The staff area lives OUTSIDE the (tabs) onboarding gate. After a fresh
 *   staff sign-in the console is REPLACED onto the app root, so `router.back()`
 *   from the coach dashboard has nothing beneath it and would exit the app —
 *   the dead-end the owner reported. `replace('/')` instead mounts the member
 *   root, and the gate (`(tabs)/_layout.tsx`) resolves it safely:
 *     onboarded  → the member tabs.
 *     !onboarded → a Redirect to `/welcome` (a real front-door screen, never a
 *                  broken loop). Staff are normal members who may never have
 *                  finished athlete onboarding, so this branch is expected.
 *   Either way the user lands somewhere real; `replace` (not `push`) also drops
 *   the console from the back stack so hardware/gesture back can't bounce them
 *   back into a half-torn-down staff screen.
 */

/** The member root. The (tabs) gate turns this into tabs OR /welcome. */
const MEMBER_ROOT = '/';

/** Leave the console for the normal athlete app WITHOUT signing out. */
export function switchToMemberApp(): void {
  router.replace(MEMBER_ROOT);
}

/**
 * Sign-out flow for staff screens: a confirm dialog + the destructive action.
 * `signOut()` clears local state instantly (offline-safe) and never navigates,
 * so this hook routes to the member root afterwards — post-sign-out the gate
 * sends an onboarded device to the tabs and a fresh one to /welcome.
 */
export function useStaffSignOut(): {
  confirming: boolean;
  signingOut: boolean;
  requestSignOut: () => void;
  cancelSignOut: () => void;
  confirmSignOut: () => void;
} {
  const signOut = useAuth((s) => s.signOut);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const requestSignOut = useCallback(() => setConfirming(true), []);
  const cancelSignOut = useCallback(() => setConfirming(false), []);

  const confirmSignOut = useCallback(() => {
    // Guard against a double-tap while the async clear is in flight.
    if (signingOut) return;
    setSigningOut(true);
    void (async () => {
      await signOut(); // never throws; clears locally even offline
      successHaptic();
      // Leave the console for the member root; the gate handles onboarded state.
      router.replace(MEMBER_ROOT);
      // The screen unmounts on navigation, but reset defensively in case the
      // navigation is a no-op (already at root during a redirect race).
      setSigningOut(false);
      setConfirming(false);
    })();
  }, [signOut, signingOut]);

  return { confirming, signingOut, requestSignOut, cancelSignOut, confirmSignOut };
}

/** The sign-out confirm dialog, pre-wired to a {@link useStaffSignOut} tuple. */
export function StaffSignOutDialog({
  confirming,
  signingOut,
  confirmSignOut,
  cancelSignOut,
}: {
  confirming: boolean;
  signingOut: boolean;
  confirmSignOut: () => void;
  cancelSignOut: () => void;
}) {
  return (
    <ConfirmDialog
      visible={confirming}
      title="Sign out of the staff console?"
      message="This signs you out completely. Your logs stay safe on this phone — signing out only disconnects your account."
      confirmLabel={signingOut ? 'Signing out…' : 'Yes, sign out'}
      cancelLabel="Stay"
      danger
      onConfirm={confirmSignOut}
      onCancel={cancelSignOut}
    />
  );
}

/**
 * A circular icon button for a console header — matches the existing back-chevron
 * button styling (48dp target, charcoal surface) so header actions line up.
 */
export function StaffHeaderAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.headerBtn}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
