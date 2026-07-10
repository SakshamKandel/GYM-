import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Button, enterUp, PRESS_SPRING, PressableScale, Screen } from '../../components/ui';
import { tapHaptic, warnHaptic } from '../../lib/haptics';
import { lookupBarcode } from '../../lib/api/openFoodFacts';
import { getRepo } from '../../lib/repo';
import { parseDateParam, parseMealParam } from '../../features/nutrition/logic';
import { customHref, portionHref } from '../../features/nutrition/nav';

/**
 * Barcode scanner — block-language chrome (REVAMP-BRIEF): the camera feed is
 * the "photo", darkened by a sanctioned black scrim with a clear scan window.
 * Four signal-red corner brackets frame the window (scanner motif — chrome,
 * not a card, so strokes are allowed), a charcoal hint pill floats below, and
 * lookup misses raise a chunky `radius.block` result sheet with the screen's
 * one red CTA.
 */

type ScanPhase =
  | { kind: 'scanning' }
  | { kind: 'busy' }
  | { kind: 'notFound' }
  | { kind: 'error' };

// Sanctioned rgba: photo scrim over the live camera feed (brief §2).
const OVERLAY = 'rgba(0, 0, 0, 0.6)';
const FRAME_W = 260;
const FRAME_H = 160;
/** Corner-bracket arm length / stroke — scanner chrome, not a card border. */
const CORNER_ARM = 34;
const CORNER_STROKE = 4;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlayFill: { flex: 1, backgroundColor: OVERLAY },
  overlayMidRow: { flexDirection: 'row', height: FRAME_H },
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width: CORNER_ARM,
    height: CORNER_ARM,
    borderColor: colors.accent,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_STROKE,
    borderLeftWidth: CORNER_STROKE,
    borderTopLeftRadius: radius.md,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_STROKE,
    borderRightWidth: CORNER_STROKE,
    borderTopRightRadius: radius.md,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_STROKE,
    borderLeftWidth: CORNER_STROKE,
    borderBottomLeftRadius: radius.md,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_STROKE,
    borderRightWidth: CORNER_STROKE,
    borderBottomRightRadius: radius.md,
  },
  // Brief signal-red wash the instant a barcode is captured.
  // (absoluteFillObject spelled out — RN 0.86 types no longer export it.)
  captureFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  bottomOverlay: {
    flex: 1,
    backgroundColor: OVERLAY,
    alignItems: 'center',
    paddingTop: spacing.gutter,
    paddingHorizontal: spacing.gutter,
  },
  // Charcoal hint pill — solid fill so the instruction stays readable over
  // any camera feed.
  hintPill: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    position: 'absolute',
    left: spacing.gutter,
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wrapper spans the viewport; the sheet itself caps at the content-column
  // width (640 − 2×20 gutters) so it stays centered on wide viewports.
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.gutter,
  },
  // Result sheet: chunky borderless block (brief §1/§3).
  sheet: {
    width: '100%',
    maxWidth: 600,
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    alignItems: 'center',
  },
  sheetButton: { alignSelf: 'stretch' },
  webCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  permissionCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});

export default function ScanScreen() {
  const params = useLocalSearchParams<{ meal?: string; date?: string }>();
  const meal = parseMealParam(params.meal);
  const date = parseDateParam(params.date);
  const insets = useSafeAreaInsets();

  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<ScanPhase>({ kind: 'scanning' });
  const handledRef = useRef(false);

  // Capture feedback: the frame settles inward and flashes signal-red the
  // instant a code is read (a user-driven moment — allowed to move).
  const reduceMotion = useReducedMotion();
  const flash = useSharedValue(0);
  const frameScale = useSharedValue(1);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const frameStyle = useAnimatedStyle(() => ({ transform: [{ scale: frameScale.value }] }));

  // Barcode scanning is a native-only flow — web gets a plain explanation.
  if (Platform.OS === 'web') {
    return (
      <Screen>
        <View style={styles.webCenter}>
          <AppText variant="title" center>
            Barcode scanning needs the phone app
          </AppText>
          <AppText variant="body" color={colors.textDim} center>
            Search for the food by name instead
          </AppText>
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  async function handleCode(code: string): Promise<void> {
    setPhase({ kind: 'busy' });
    try {
      const repo = await getRepo();
      const local = await repo.getFoodByBarcode(code);
      if (local) {
        router.replace(portionHref(local.id, meal, date));
        return;
      }
      const remote = await lookupBarcode(code);
      if (remote) {
        await repo.saveFood(remote);
        router.replace(portionHref(remote.id, meal, date));
        return;
      }
      warnHaptic();
      setPhase({ kind: 'notFound' });
    } catch {
      warnHaptic();
      setPhase({ kind: 'error' });
    }
  }

  function onBarcodeScanned(result: BarcodeScanningResult): void {
    if (handledRef.current) return;
    handledRef.current = true;
    // Confirm the capture immediately, before the async lookup resolves.
    tapHaptic();
    if (!reduceMotion) {
      flash.value = withSequence(
        withTiming(0.4, { duration: 80 }),
        withTiming(0, { duration: 280 }),
      );
      frameScale.value = withSequence(
        withTiming(0.95, { duration: 90 }),
        withSpring(1, PRESS_SPRING),
      );
    }
    void handleCode(result.data);
  }

  function scanAgain(): void {
    handledRef.current = false;
    setPhase({ kind: 'scanning' });
  }

  if (!permission) {
    return <Screen>{null}</Screen>;
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.permissionCenter}>
          <AppText variant="title" center>
            Camera access needed
          </AppText>
          <AppText variant="body" color={colors.textDim} center>
            The camera is only used to read barcodes on food packaging. Nothing is recorded.
          </AppText>
          <Button label="Grant camera access" onPress={() => void requestPermission()} />
          <Button label="Go back" variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={phase.kind === 'scanning' ? onBarcodeScanned : undefined}
      />

      {/* Dark scrim with a clear scan window, framed by red corner brackets */}
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.overlayFill} />
        <View style={styles.overlayMidRow}>
          <View style={styles.overlayFill} />
          <Animated.View style={[styles.frame, frameStyle]}>
            <View pointerEvents="none" style={[styles.corner, styles.cornerTL]} />
            <View pointerEvents="none" style={[styles.corner, styles.cornerTR]} />
            <View pointerEvents="none" style={[styles.corner, styles.cornerBL]} />
            <View pointerEvents="none" style={[styles.corner, styles.cornerBR]} />
            <Animated.View
              pointerEvents="none"
              style={[styles.captureFlash, flashStyle]}
            />
            {phase.kind === 'busy' ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : null}
          </Animated.View>
          <View style={styles.overlayFill} />
        </View>
        <View style={styles.bottomOverlay}>
          <AppText variant="label" color={colors.text}>
            Scan barcode
          </AppText>
          <View style={styles.hintPill}>
            <AppText variant="body" color={colors.text} center>
              {phase.kind === 'busy' ? 'Looking it up…' : 'Line the barcode up inside the frame'}
            </AppText>
          </View>
        </View>
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        // Camera overlay bypasses <Screen> — keep the button clear of the top
        // edge even when the status-bar inset is 0.
        style={[styles.backBtn, { top: insets.top + spacing.gutter }]}
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </PressableScale>

      {phase.kind === 'notFound' || phase.kind === 'error' ? (
        <View
          style={[styles.sheetWrap, { bottom: insets.bottom + spacing.xl }]}
          pointerEvents="box-none"
        >
          <Animated.View entering={enterUp(0)} style={styles.sheet}>
            <AppText variant="title" center>
              {phase.kind === 'notFound' ? 'Not in the database' : 'Couldn’t reach food database'}
            </AppText>
            <AppText variant="body" color={colors.textDim} center>
              {phase.kind === 'notFound'
                ? 'You can create it once and reuse it forever'
                : 'Check your connection and try again'}
            </AppText>
            {phase.kind === 'notFound' ? (
              <Button
                label="Create custom food"
                onPress={() => router.replace(customHref(meal, date))}
                style={styles.sheetButton}
              />
            ) : null}
            <Button label="Scan again" variant="ghost" onPress={scanAgain} />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}
