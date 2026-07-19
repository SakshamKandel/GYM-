import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Height of the Android 3-button navigation bar (dp). Used as the fallback
 * clearance when a device reports a bottom inset of 0 under edge-to-edge —
 * the one value that keeps a bottom-anchored control clear of the system bar
 * in every navigation mode.
 */
const ANDROID_NAV_FALLBACK = 48;

/**
 * Bottom clearance above the system navigation area for bottom-anchored
 * interactive surfaces (docks, pinned CTAs, tab bars, sheets).
 *
 * insets.bottom is the truth (gesture bar ~24, 3-button bar ~48) — but a
 * number of Android OEM builds report 0 under edge-to-edge, which sat
 * bottom-anchored buttons underneath the 3-button bar, making them
 * unclickable. Because android.edgeToEdgeEnabled is on, every Android build
 * draws under the bar, so a 0 report is always wrong there: fall back to the
 * 3-button height. iOS and web report insets correctly (0 means genuinely
 * flush is fine), so they pass through untouched.
 *
 * Callers add their own aesthetic minimum on top, e.g.
 * `Math.max(useBottomClearance(), spacing.lg)`.
 */
export function useBottomClearance(): number {
  const insets = useSafeAreaInsets();
  if (insets.bottom > 0) return insets.bottom;
  return Platform.OS === 'android' ? ANDROID_NAV_FALLBACK : 0;
}
