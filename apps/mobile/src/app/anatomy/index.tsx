import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { enterFade, PressableScale, Screen } from '../../components/ui';
import { AnatomyExplorer } from '../../features/anatomy/AnatomyExplorer';
import { isMuscleGroup, type MuscleGroup } from '../../lib/muscleMap';

/**
 * /anatomy?muscle=chest — full-screen muscle encyclopedia. Pushed from the
 * Train tab's muscle map and from exercise detail muscle chips.
 */

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.md },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function AnatomyScreen() {
  const params = useLocalSearchParams<{ muscle?: string }>();
  const initial: MuscleGroup =
    typeof params.muscle === 'string' && isMuscleGroup(params.muscle)
      ? params.muscle
      : 'chest';

  return (
    <Screen scroll>
      <Animated.View entering={enterFade()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/train');
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <AnatomyExplorer initialMuscle={initial} />
    </Screen>
  );
}
