import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { enterDown, PressableScale } from '../../../components/ui';

/** Back-chevron header row for pushed /body screens. */

const styles = StyleSheet.create({
  // Screen already adds 16px top air; xs on top keeps total ~20 instead of 28.
  row: { paddingTop: spacing.xs, paddingBottom: spacing.md },
  btn: {
    // touch.min (48dp) — meets the minimum tap target.
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function BackHeader() {
  return (
    <Animated.View entering={enterDown(0)} style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        style={styles.btn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </PressableScale>
    </Animated.View>
  );
}
