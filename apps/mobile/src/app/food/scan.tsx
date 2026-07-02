import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Button, enterUp, PressableScale, Screen } from '../../components/ui';
import { tapHaptic, warnHaptic } from '../../lib/haptics';
import { lookupBarcode } from '../../lib/api/openFoodFacts';
import { getRepo } from '../../lib/repo';
import { parseDateParam, parseMealParam } from '../../features/nutrition/logic';
import { customHref, portionHref } from '../../features/nutrition/nav';

type ScanPhase =
  | { kind: 'scanning' }
  | { kind: 'busy' }
  | { kind: 'notFound' }
  | { kind: 'error' };

const OVERLAY = 'rgba(19, 20, 22, 0.55)';
const FRAME_W = 260;
const FRAME_H = 160;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlayFill: { flex: 1, backgroundColor: OVERLAY },
  overlayMidRow: { flexDirection: 'row', height: FRAME_H },
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomOverlay: {
    flex: 1,
    backgroundColor: OVERLAY,
    alignItems: 'center',
    paddingTop: spacing.lg,
  },
  backBtn: {
    position: 'absolute',
    left: spacing.lg,
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
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 600,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
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

  // Barcode scanning is a native-only flow — web gets a plain explanation.
  if (Platform.OS === 'web') {
    return (
      <Screen>
        <View style={styles.webCenter}>
          <AppText variant="title" center>
            Barcode scanning needs the phone app
          </AppText>
          <AppText variant="caption" color={colors.textDim} center>
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
        tapHaptic();
        router.replace(portionHref(local.id, meal, date));
        return;
      }
      const remote = await lookupBarcode(code);
      if (remote) {
        await repo.saveFood(remote);
        tapHaptic();
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

      {/* Dark overlay with a transparent scan-frame cutout */}
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.overlayFill} />
        <View style={styles.overlayMidRow}>
          <View style={styles.overlayFill} />
          <View style={styles.frame}>
            {phase.kind === 'busy' ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : null}
          </View>
          <View style={styles.overlayFill} />
        </View>
        <View style={styles.bottomOverlay}>
          <AppText variant="caption" color={colors.text}>
            Point at the barcode
          </AppText>
        </View>
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        // Camera overlay bypasses <Screen> — keep the button clear of the top
        // edge even when the status-bar inset is 0.
        style={[styles.backBtn, { top: insets.top + spacing.lg }]}
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
            <AppText variant="caption" color={colors.textDim} center>
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
