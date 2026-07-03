import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, spacing, touch } from '@gym/ui-tokens';
import { AppText, enterFade, IconChip } from '../../../components/ui';

/**
 * Brief "it landed" affirmation shown in place of the Save button after a
 * successful write, just before the screen pops. A quiet fade (reduced-motion
 * safe) plus the check chip — the moment, not a spectacle.
 */

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    minHeight: touch.primary,
  },
});

export function SaveConfirmation({ label = 'Saved' }: { label?: string }) {
  return (
    <Animated.View
      entering={enterFade(0)}
      style={styles.wrap}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <IconChip icon="checkmark" iconColor={colors.success} size={36} />
      <AppText variant="title">{label}</AppText>
    </Animated.View>
  );
}
