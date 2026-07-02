import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors } from '@gym/ui-tokens';
import { replacePath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';

/**
 * /workout/start?planWorkoutId=<id> — route contract shared with the Home tab.
 * Creates the workout log (or resumes an already-active one) and hands off to
 * the logger. No param → freestyle session.
 */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function StartWorkoutScreen() {
  const { planWorkoutId } = useLocalSearchParams<{ planWorkoutId?: string }>();

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const id = typeof planWorkoutId === 'string' && planWorkoutId.length > 0 ? planWorkoutId : null;
      await useSession.getState().start(id);
      if (mounted) replacePath('/workout');
    })();
    return () => {
      mounted = false;
    };
  }, [planWorkoutId]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
