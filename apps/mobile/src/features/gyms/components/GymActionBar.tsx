import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';
import { useBottomClearance } from '../../../lib/systemBars';

/**
 * Sticky bottom action bar for the gym detail page (brief §2) — Call /
 * Directions / Website. Rendered as a sibling OVER the scroll content (pinned
 * to the screen bottom, safe-area aware) so it stays reachable while the page
 * scrolls. Directions is the single primary (red) action; Call/Website are
 * charcoal secondaries, and each is hidden when the gym has no such contact.
 * Every button clears the 48dp touch minimum.
 */

interface Props {
  onDirections: () => void;
  /** Omit to hide the Call button (no phone on file). */
  onCall?: () => void;
  /** Omit to hide the Website button (no website on file). */
  onWebsite?: () => void;
  /** Names the gym in each button's a11y label. */
  gymName: string;
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inner: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    // Phone-first line length parity with the Screen shell.
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
  },
  secondary: { flex: 1, backgroundColor: colors.surfaceRaised },
  primary: { flex: 1.4, backgroundColor: colors.accent },
});

export function GymActionBar({ onDirections, onCall, onWebsite, gymName }: Props) {
  // useBottomClearance (not raw insets.bottom): some Android OEM builds report
  // a 0 bottom inset under edge-to-edge, which slid these buttons under the
  // 48dp 3-button bar. spacing.md stays additive as breathing room on top.
  const bottomClearance = useBottomClearance();

  return (
    <View style={[styles.bar, { paddingBottom: bottomClearance + spacing.md }]}>
      <View style={styles.inner}>
        {onCall ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Call ${gymName}`}
            onPress={onCall}
            style={[styles.btn, styles.secondary]}
          >
            <Ionicons name="call" size={18} color={colors.text} />
            <AppText variant="label" color={colors.text}>
              Call
            </AppText>
          </PressableScale>
        ) : null}

        {onWebsite ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Open ${gymName}'s website`}
            onPress={onWebsite}
            style={[styles.btn, styles.secondary]}
          >
            <Ionicons name="globe-outline" size={18} color={colors.text} />
            <AppText variant="label" color={colors.text}>
              Website
            </AppText>
          </PressableScale>
        ) : null}

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Get directions to ${gymName}`}
          onPress={onDirections}
          style={[styles.btn, styles.primary]}
        >
          <Ionicons name="navigate" size={18} color={colors.onBlock} />
          <AppText variant="label" color={colors.onBlock}>
            Directions
          </AppText>
        </PressableScale>
      </View>
    </View>
  );
}
