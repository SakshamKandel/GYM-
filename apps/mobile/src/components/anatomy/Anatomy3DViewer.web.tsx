import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Chip } from '../ui';
import { tapHaptic } from '../../lib/haptics';
import { isMuscleGroup, MUSCLE_LABELS } from '../../lib/muscleMap';
import { buildViewerHtml } from './buildViewerHtml';
import type { Anatomy3DViewerProps } from './config';
import { Anatomy2DViewer } from './Anatomy2DViewer';

/**
 * Web implementation of the 3D muscle body: the three.js scene runs in a
 * sandboxed `<iframe srcDoc>` and talks to React via `postMessage`. Taps in the
 * scene arrive as `select`; selection/side changes are pushed in as `highlight`
 * once the iframe reports `ready`.
 */

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.block,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    width: '100%',
  },
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
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<ViewerStatus>('loading');

  // Build the document once; initial state is baked in so the first paint is
  // already correct even before the ready handshake completes.
  const [html] = useState(() =>
    buildViewerHtml({ selected, side, autoRotate: !reduceMotion && selected === null }),
  );

  useEffect(() => {
    if (status !== 'loading') return undefined;
    const timeout = setTimeout(() => setStatus('error'), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [status]);

  // viewer → React
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (frameRef.current && ev.source !== frameRef.current.contentWindow) return;
      let data: unknown = ev.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const msg = data as { type?: string; muscle?: string; message?: string };
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') setStatus('ready');
      else if (msg.type === 'error') {
        if (__DEV__) console.warn(`[Anatomy3D] ${msg.message ?? 'viewer failed'}`);
        setStatus('error');
      }
      else if (msg.type === 'select' && msg.muscle && isMuscleGroup(msg.muscle)) {
        tapHaptic();
        onSelect(msg.muscle);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect]);

  // React → viewer (only after ready, and whenever selection/side changes)
  useEffect(() => {
    if (status !== 'ready') return;
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ type: 'highlight', muscle: selected, side }),
      '*',
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
      {/* Runtime, decoder, and model are embedded so srcDoc stays fully offline. */}
      <iframe
        ref={frameRef}
        srcDoc={html}
        title="3D muscle anatomy"
        style={{ border: 'none', width: '100%', height: '100%', background: colors.bg }}
        // The generated document is self-contained; scripts are allowed but it
        // receives no same-origin access to the host app.
        sandbox="allow-scripts"
        onError={() => setStatus('error')}
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
