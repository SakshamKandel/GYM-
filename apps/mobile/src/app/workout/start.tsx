import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, enterFade } from '../../components/ui';
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
  center: { alignItems: 'center', gap: spacing.md },
});

export default function StartWorkoutScreen() {
  const { planWorkoutId } = useLocalSearchParams<{ planWorkoutId?: string }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const id = typeof planWorkoutId === 'string' && planWorkoutId.length > 0 ? planWorkoutId : null;
      try {
        await useSession.getState().start(id);
        if (mounted) replacePath('/workout');
      } catch {
        if (mounted) setFailed(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [planWorkoutId]);

  return (
    <View style={styles.root}>
      <Animated.View entering={enterFade(0)} style={styles.center}>
        {failed ? (
          <>
            <AppText variant="bodyBold">Workout unavailable</AppText>
            <AppText variant="body" color={colors.textDim} center>
              This workout is no longer published for your account.
            </AppText>
            <Button
              label="Back to Train"
              variant="secondary"
              onPress={() => replacePath('/(tabs)/train')}
            />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <AppText variant="label" color={colors.textDim}>Starting…</AppText>
          </>
        )}
      </Animated.View>
    </View>
  );
}
