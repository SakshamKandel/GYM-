import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';

/**
 * Greece's coach demo player. Renders his hosted clip inside a rounded surface
 * block that matches the exercise image styling. The exercise's own photo shows
 * as the poster/first-frame until the video paints, so the block never flashes
 * empty. Playback uses expo-video's native controls (play/pause/scrub).
 */
interface Props {
  /** Public https URL to Greece's .mp4/.m3u8 clip. */
  url: string;
  /** Exercise photo used as the poster behind the video. */
  posterUri?: string;
  /** Caption under the player. */
  label?: string;
}

const styles = StyleSheet.create({
  // Same rounded framing as the exercise image block on the detail screen.
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  poster: { width: '100%', height: '100%' },
  caption: { marginTop: spacing.sm },
});

export function ExerciseVideo({ url, posterUri, label }: Props) {
  // Load paused so nothing autoplays — the coach demo is opt-in via the controls.
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
  });
  const [firstFrame, setFirstFrame] = useState(false);

  return (
    <View>
      <View style={styles.frame}>
        <VideoView
          player={player}
          style={styles.fill}
          contentFit="contain"
          nativeControls
          onFirstFrameRender={() => setFirstFrame(true)}
          accessibilityLabel={label ?? "Greece's demo video"}
        />
        {/* Poster sits above the (still-black) video surface until the first
            frame renders, then unmounts. Falls back to nothing if no photo. */}
        {!firstFrame && posterUri ? (
          <Image
            source={{ uri: posterUri }}
            style={[styles.fill, styles.poster]}
            contentFit="contain"
            transition={150}
            pointerEvents="none"
          />
        ) : null}
      </View>
      <AppText variant="caption" color={colors.textDim} style={styles.caption}>
        {label ?? "Greece's demo"}
      </AppText>
    </View>
  );
}
