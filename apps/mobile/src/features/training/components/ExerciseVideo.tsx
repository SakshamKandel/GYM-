import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button } from '../../../components/ui';

/**
 * Coach demo player. Renders a hosted clip inside a rounded surface block that
 * matches the exercise image styling. The exercise's own photo shows as the
 * poster/first-frame until the video paints, so the block never flashes empty.
 * Playback uses expo-video's native controls (play/pause/scrub).
 *
 * The player is never left as a silent black rectangle: it reports its own
 * status, so a clip that is still loading shows a spinner and one that failed
 * (dead link, expired signature, no connection) shows a short message with a
 * way to try again. The retry rebuilds the player from scratch — see
 * {@link ExerciseVideo} — and, when the screen can also re-issue the link,
 * `onRetry` lets it do that in the same tap.
 */
interface Props {
  /** Public https URL to the .mp4/.m3u8 clip. */
  url: string;
  /** Exercise photo used as the poster behind the video. */
  posterUri?: string;
  /** Caption under the player. */
  label?: string;
  /**
   * Called alongside the internal rebuild when the member taps Try again.
   * Screens whose URL is short-lived use this to fetch a fresh one.
   */
  onRetry?: () => void;
}

/** A clip stuck loading past this is treated as failed rather than spun forever. */
const LOAD_TIMEOUT_MS = 20_000;

const styles = StyleSheet.create({
  // Media frames are inner elements in the block language → radius.md,
  // charcoal fill, no border.
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
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
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  overlaySolid: { backgroundColor: colors.surface },
  overlayText: { textAlign: 'center' },
});

export function ExerciseVideo({ url, posterUri, label, onRetry }: Props) {
  // Bumping this remounts the inner player, which is what actually rebuilds the
  // expo-video instance: a player that has already errored will not recover by
  // being told to play again.
  const [attempt, setAttempt] = useState(0);

  return (
    <ExerciseVideoPlayer
      key={`${url}:${attempt}`}
      url={url}
      posterUri={posterUri}
      label={label}
      onRetry={() => {
        setAttempt((n) => n + 1);
        onRetry?.();
      }}
    />
  );
}

function ExerciseVideoPlayer({
  url,
  posterUri,
  label,
  onRetry,
}: Props & { onRetry: () => void }) {
  // Load paused so nothing autoplays — the coach demo is opt-in via the controls.
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
  });
  const [firstFrame, setFirstFrame] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (player.status === 'readyToPlay') setReady(true);
    if (player.status === 'error') setFailed(true);
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'readyToPlay') setReady(true);
      if (payload.status === 'error') setFailed(true);
    });
    return () => sub.remove();
  }, [player]);

  // Nothing reports a stream that simply never arrives, so cap the wait.
  useEffect(() => {
    if (ready || failed) return undefined;
    const timer = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready, failed]);

  // The poster covers the black surface until the first frame paints, and steps
  // aside for the error message so it can't be mistaken for a playing video.
  const poster = !firstFrame && !failed ? posterUri : undefined;

  return (
    <View>
      <View style={styles.frame}>
        <VideoView
          player={player}
          style={styles.fill}
          contentFit="contain"
          nativeControls
          onFirstFrameRender={() => setFirstFrame(true)}
          accessibilityLabel={label ?? 'Coach demo video'}
        />
        {poster ? (
          <Image
            source={{ uri: poster }}
            style={[styles.fill, styles.poster]}
            contentFit="contain"
            transition={150}
            pointerEvents="none"
          />
        ) : null}
        {failed ? (
          <View style={[styles.overlay, styles.overlaySolid]} accessibilityLiveRegion="polite">
            <AppText variant="bodyBold" style={styles.overlayText}>
              This clip won’t play
            </AppText>
            <AppText variant="caption" color={colors.textDim} style={styles.overlayText}>
              Check your connection and give it another go.
            </AppText>
            <Button label="Try again" variant="secondary" onPress={onRetry} />
          </View>
        ) : !ready && !firstFrame ? (
          // Transparent when a poster is showing, so the photo stays visible
          // with the spinner over it; opaque only when there is nothing behind.
          <View
            style={[styles.overlay, poster ? null : styles.overlaySolid]}
            pointerEvents="none"
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator color={colors.accent} />
            <AppText variant="caption" color={colors.textDim}>
              Loading the clip…
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="label" color={colors.textDim} style={styles.caption}>
        {label ?? 'Coach demo'}
      </AppText>
    </View>
  );
}
