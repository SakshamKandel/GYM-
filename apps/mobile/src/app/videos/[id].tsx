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
 * plays it with the shared ExerciseVideo surface. Locked → paywall affordance.
 *
 * The failure branches are split rather than collapsed into one "unavailable"
 * dead end, because they need different words and different offers: a removed
 * video only earns a way back, while a link problem or playback not being
 * switched on yet is worth another try. Try again re-mints the signed link —
 * the player's own retry can only rebuild itself, and a link that has already
 * expired never recovers from that alone, so the player's retry is wired to the
 * same refetch.
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
          <ExerciseVideo url={state.url} label={state.title} onRetry={state.reload} />
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
      ) : state.status === 'notFound' ? (
        <EmptyState
          icon="videocam-off-outline"
          title="This video is gone"
          body="It's no longer in the coach library."
          actionLabel="Back to videos"
          onAction={() => router.replace('/videos' as Href)}
        />
      ) : state.status === 'notConfigured' ? (
        <EmptyState
          icon="construct-outline"
          title="Not ready yet"
          body="Coach videos aren't switched on right now. Have another go in a bit."
          actionLabel="Try again"
          onAction={state.reload}
        />
      ) : (
        <EmptyState
          icon="cloud-offline-outline"
          title="Video won't play"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={state.reload}
        />
      )}
    </Screen>
  );
}
