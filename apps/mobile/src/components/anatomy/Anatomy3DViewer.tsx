import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useReducedMotion } from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Chip } from '../ui';
import { tapHaptic } from '../../lib/haptics';
import { isMuscleGroup, MUSCLE_LABELS } from '../../lib/muscleMap';
import { buildViewerHtml } from './buildViewerHtml';
import type { Anatomy3DViewerProps } from './config';
import { Anatomy2DViewer } from './Anatomy2DViewer';

/**
 * Native implementation of the 3D muscle body: the same three.js scene runs
 * inside a `react-native-webview`. Taps arrive as `select` via `onMessage`;
 * selection/side changes are injected as `highlight` once the page reports
 * `ready`.
 *
 * `react-native-webview` 13.16.1 is bundled in Expo Go for SDK 57 and is also
 * linked automatically in development/production builds.
 */

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.block,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    width: '100%',
  },
  webview: { flex: 1, backgroundColor: 'transparent' },
  loadingWrap: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  hintWrap: { position: 'absolute', zIndex: 3, left: spacing.md, bottom: spacing.md },
  selectedLabel: {
    position: 'absolute',
    zIndex: 3,
    right: spacing.md,
    bottom: spacing.md,
    alignItems: 'flex-end',
  },
  sideChips: {
    position: 'absolute',
    zIndex: 3,
    left: spacing.md,
    right: spacing.md,
    top: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

type ViewerStatus = 'loading' | 'ready' | 'error';
const LOAD_TIMEOUT_MS = 15_000;

export function Anatomy3DViewer({
  selected,
  onSelect,
  side,
  height = 420,
  overlays = true,
  onSideChange,
}: Anatomy3DViewerProps) {
  const webRef = useRef<WebView | null>(null);
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<ViewerStatus>('loading');

  const [html] = useState(() =>
    buildViewerHtml({ selected, side, autoRotate: !reduceMotion && selected === null }),
  );

  useEffect(() => {
    if (status !== 'loading') return undefined;
    const timeout = setTimeout(() => setStatus('error'), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [status]);

  const onMessage = (ev: WebViewMessageEvent): void => {
    let data: unknown;
    try {
      data = JSON.parse(ev.nativeEvent.data);
    } catch {
      return;
    }
    const msg = data as { type?: string; muscle?: string };
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') setStatus('ready');
    else if (msg.type === 'error') setStatus('error');
    else if (msg.type === 'select' && msg.muscle && isMuscleGroup(msg.muscle)) {
      tapHaptic();
      onSelect(msg.muscle);
    }
  };

  // Push highlight/side into the scene once ready and on every change.
  useEffect(() => {
    if (status !== 'ready' || !webRef.current) return;
    const payload = JSON.stringify({ type: 'highlight', muscle: selected, side });
    webRef.current.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(payload)}}));true;`,
    );
  }, [status, selected, side]);

  if (status === 'error') {
    return (
      <Anatomy2DViewer
        selected={selected}
        onSelect={onSelect}
        side={side}
        height={height}
        overlays={overlays}
        onSideChange={onSideChange}
      />
    );
  }

  return (
    <View style={[styles.panel, { height }]}>
      <WebView
        ref={webRef}
        source={{ html }}
        originWhitelist={['*']}
        style={styles.webview}
        containerStyle={{ backgroundColor: 'transparent' }}
        onMessage={onMessage}
        onError={() => setStatus('error')}
        onHttpError={() => setStatus('error')}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        // let the WebView own its drag gestures inside the parent ScrollView
        nestedScrollEnabled
        accessible
        accessibilityLabel={
          selected
            ? `Interactive 3D body. ${MUSCLE_LABELS[selected]} highlighted.`
            : 'Interactive 3D muscle body.'
        }
        accessibilityHint="Drag to rotate, pinch to zoom, or use the muscle buttons below."
      />
      {status === 'loading' ? (
        <View style={styles.loadingWrap} pointerEvents="none" accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.accent} />
          <AppText variant="body" color={colors.textDim}>
            Loading 3D body…
          </AppText>
        </View>
      ) : null}
      {onSideChange ? (
        <View style={styles.sideChips}>
          <Chip label="Front" selected={side === 'front'} onPress={() => onSideChange('front')} />
          <Chip label="Back" selected={side === 'back'} onPress={() => onSideChange('back')} />
        </View>
      ) : null}
      {overlays ? (
        <>
          <View style={styles.hintWrap} pointerEvents="none">
            <AppText variant="body" color={colors.textDim} numberOfLines={1}>
              Drag · pinch · tap
            </AppText>
          </View>
          {selected ? (
            <View style={styles.selectedLabel} pointerEvents="none">
              <AppText variant="label" color={colors.textDim}>
                Selected
              </AppText>
              <AppText variant="title" color={colors.accent}>
                {MUSCLE_LABELS[selected]}
              </AppText>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
