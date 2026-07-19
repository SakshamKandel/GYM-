import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  EmptyState,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  Skeleton,
  Tag,
} from '../../components/ui';
import { ExerciseVideo } from '../../features/training/components/ExerciseVideo';
import { useVideoPlayback } from '../../features/training/videoLibrary';

/**
 * Video player — resolves a short-lived signed URL for one library video and
 * plays it with the shared ExerciseVideo (expo-video) surface. Locked → paywall
 * affordance; anything else → a graceful unavailable state with a way back.
 */

const styles = StyleSheet.create({
  body: { marginTop: spacing.lg },
  description: { marginTop: spacing.lg },
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  lockedText: { flex: 1, minWidth: 0 },
});

export default function VideoPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useVideoPlayback(typeof id === 'string' ? id : '');

  return (
    <Screen scroll>
      <ScreenHeader eyebrow="Coach library" title="Watch" />

      {state.status === 'loading' ? (
        <Skeleton height={240} radius={radius.md} style={styles.body} />
      ) : state.status === 'ready' ? (
        <Animated.View entering={enterUp(0)} style={styles.body}>
          <ExerciseVideo url={state.url} label={state.title} />
          {state.description.trim().length > 0 ? (
            <AppText variant="body" color={colors.textDim} style={styles.description}>
              {state.description}
            </AppText>
          ) : null}
        </Animated.View>
      ) : state.status === 'locked' ? (
        <Animated.View entering={enterUp(0)}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Locked video. Unlock with the ${
              state.requiredTier.charAt(0).toUpperCase() + state.requiredTier.slice(1)
            } plan.`}
            onPress={() => router.push('/subscribe' as Href)}
            style={styles.lockedCard}
          >
            <IconChip icon="lock-closed" color={colors.surfaceRaised} iconColor={colors.accent} />
            <View style={styles.lockedText}>
              <AppText variant="bodyBold">Locked video</AppText>
              <AppText variant="caption" color={colors.textDim}>
                Unlock coach demos with an upgrade.
              </AppText>
            </View>
            <Tag
              label={state.requiredTier.charAt(0).toUpperCase() + state.requiredTier.slice(1)}
              variant="filled"
            />
          </PressableScale>
        </Animated.View>
      ) : (
        <EmptyState
          icon="videocam-off-outline"
          title="Video unavailable"
          body="This video can't be played right now. It may have been removed."
        />
      )}
    </Screen>
  );
}
