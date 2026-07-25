import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button } from '../../../components/ui';

/**
 * Web implementation of the coach demo player (platform split, same shape as
 * PrCelebration/Anatomy3DViewer).
 *
 * expo-video's web player is a bare `<video>` element, and signed coach playback
 * links are HLS (`.m3u8`). Only Safari can play that natively, so on every other
 * browser the native player silently produced a black rectangle that never
 * started. This renders the `<video>` element directly and, ONLY when the
 * browser cannot handle HLS itself, pulls in hls.js to feed the element. A
 * plain .mp4 link never loads the library at all.
 *
 * Loading, failure and retry are handled here too: a dead link, an expired
 * signature or a stalled stream shows a short message with a Try again that
 * rebuilds the source, and calls `onRetry` so the screen can also fetch a fresh
 * link (a signed URL that has expired cannot be recovered by reloading it).
 */
interface Props {
  /** Public https URL to the .mp4/.m3u8 clip. */
  url: string;
  /** Exercise photo used as the poster behind the video. */
  posterUri?: string;
  /** Caption under the player. */
  label?: string;
  /** Called alongside the rebuild when the member taps Try again. */
  onRetry?: () => void;
}

/** A clip stuck loading past this is treated as failed rather than spun forever. */
const LOAD_TIMEOUT_MS = 20_000;

/**
 * The slice of hls.js this component uses, declared structurally so the import
 * below stays a runtime detail and the component never depends on the library's
 * own type surface.
 */
interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  destroy(): void;
  on(event: string, handler: (event: string, data: { fatal?: boolean }) => void): void;
}
interface HlsConstructor {
  new (): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
}

/** Does this look like an HLS playlist rather than a progressive file? */
function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
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

const videoStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  backgroundColor: colors.surface,
} as const;

export function ExerciseVideo({ url, posterUri, label, onRetry }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    let cancelled = false;
    let hls: HlsInstance | null = null;
    setStatus('loading');

    // Safari (and iOS web) plays HLS itself; everywhere else canPlayType is ''.
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

    if (!isHlsUrl(url) || nativeHls) {
      video.src = url;
      video.load();
    } else {
      void (async () => {
        try {
          // Loaded on demand so browsers that never need it (and the native
          // builds, which never reach this file) don't pay for the library.
          const mod = (await import('hls.js')) as unknown as { default: HlsConstructor };
          if (cancelled) return;
          const Hls = mod.default;
          if (!Hls.isSupported()) {
            setStatus('error');
            return;
          }
          const instance = new Hls();
          hls = instance;
          instance.on(Hls.Events.ERROR, (_event, data) => {
            // Non-fatal errors are recovered by hls.js itself; only a fatal one
            // means the stream is genuinely not coming.
            if (data.fatal) setStatus('error');
          });
          instance.loadSource(url);
          instance.attachMedia(video);
        } catch {
          if (!cancelled) setStatus('error');
        }
      })();
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      hls = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [url, attempt]);

  // Nothing reports a stream that simply never arrives, so cap the wait.
  useEffect(() => {
    if (status !== 'loading') return undefined;
    const timer = setTimeout(() => setStatus('error'), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, attempt]);

  function retry() {
    setStatus('loading');
    setAttempt((n) => n + 1);
    onRetry?.();
  }

  return (
    <View>
      <View style={styles.frame}>
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={posterUri}
          aria-label={label ?? 'Coach demo video'}
          style={videoStyle}
          onLoadedData={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
        {status === 'error' ? (
          <View style={[styles.overlay, styles.overlaySolid]} accessibilityLiveRegion="polite">
            <AppText variant="bodyBold" style={styles.overlayText}>
              This clip won’t play
            </AppText>
            <AppText variant="caption" color={colors.textDim} style={styles.overlayText}>
              Check your connection and give it another go.
            </AppText>
            <Button label="Try again" variant="secondary" onPress={retry} />
          </View>
        ) : status === 'loading' ? (
          // Transparent when a poster is showing, so the photo stays visible
          // with the spinner over it; opaque only when there is nothing behind.
          <View
            style={[styles.overlay, posterUri ? null : styles.overlaySolid]}
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
