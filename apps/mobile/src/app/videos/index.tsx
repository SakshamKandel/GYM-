import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  EmptyState,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  Tag,
} from '../../components/ui';
import {
  formatDuration,
  useVideoLibrary,
  type VideoLibraryItem,
} from '../../features/training/videoLibrary';

/**
 * Coach video library — a standalone browse of every `ready` form-check video.
 * Rows the member's tier unlocks open the player; locked rows route to the
 * paywall. Reached from the Train tab.
 */

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 72,
  },
  rowGap: { marginTop: spacing.sm },
  thumb: {
    width: 72,
    height: 54,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbFallback: {
    width: 72,
    height: 54,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  meta: { marginTop: 2 },
});

function VideoRow({ item, index }: { item: VideoLibraryItem; index: number }) {
  const duration = formatDuration(item.durationSec);
  const metaParts = [item.exerciseName ?? undefined, duration ?? undefined].filter(
    (p): p is string => !!p,
  );
  const tierLabel = item.tierRequired.charAt(0).toUpperCase() + item.tierRequired.slice(1);

  return (
    <Animated.View entering={enterUp(Math.min(1 + index, 8))} style={index > 0 ? styles.rowGap : undefined}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          item.locked
            ? `${item.title}. Locked — unlock with the ${tierLabel} plan.`
            : `${item.title}. Play video.`
        }
        pressScale={0.985}
        onPress={() =>
          item.locked
            ? router.push('/subscribe' as Href)
            : router.push(`/videos/${encodeURIComponent(item.id)}` as Href)
        }
        style={styles.row}
      >
        {item.thumbnailUrl ? (
          <View style={styles.thumb}>
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.thumbImg}
              contentFit="cover"
              transition={150}
            />
          </View>
        ) : (
          <View style={styles.thumbFallback}>
            <Ionicons
              name={item.locked ? 'lock-closed' : 'play'}
              size={20}
              color={colors.accent}
            />
          </View>
        )}
        <View style={styles.rowText}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {item.title}
          </AppText>
          {metaParts.length > 0 ? (
            <AppText variant="caption" color={colors.textDim} numberOfLines={1} style={styles.meta}>
              {metaParts.join(' · ')}
            </AppText>
          ) : null}
        </View>
        {item.locked ? (
          <Tag label={tierLabel} variant="filled" />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        )}
      </PressableScale>
    </Animated.View>
  );
}

export default function VideosScreen() {
  const { status, videos } = useVideoLibrary();

  return (
    <Screen scroll>
      <ScreenHeader eyebrow="Coach library" title="Videos" />

      {status === 'loading' ? (
        <View style={{ marginTop: spacing.lg }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              height={72}
              radius={radius.md}
              style={i > 0 ? styles.rowGap : undefined}
            />
          ))}
        </View>
      ) : status === 'signedOut' ? (
        <EmptyState
          icon="log-in-outline"
          title="Sign in to watch"
          body="Coach form-check videos are available once you're signed in."
        />
      ) : status === 'error' ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load videos"
          body="Check your connection and try again in a moment."
        />
      ) : videos.length === 0 ? (
        <EmptyState
          icon="videocam-outline"
          title="No videos yet"
          body="Coach demos will appear here as they're published."
        />
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          <SectionLabel>{`${videos.length} ${videos.length === 1 ? 'video' : 'videos'}`}</SectionLabel>
          {videos.map((v, i) => (
            <VideoRow key={v.id} item={v} index={i} />
          ))}
        </View>
      )}
    </Screen>
  );
}
