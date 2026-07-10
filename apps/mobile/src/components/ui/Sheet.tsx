import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Dimensions, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { SHEET_SPRING } from './motion';

/**
 * Reusable bottom sheet. Backdrop fades in; the panel springs UP from the
 * bottom (a tap-opened, user-driven move — allowed by the motion philosophy).
 * Dismiss by backdrop tap or a drag-down gesture; the exit animation always
 * finishes before onClose fires, so the Modal stays mounted the whole time.
 *
 * Contract: `visible` is controlled — `onClose` MUST flip it to false.
 */
export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const { height: WINDOW_H } = Dimensions.get('window');
const isNative = Platform.OS !== 'web';

// Dismiss thresholds for the drag-down gesture.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // The single sanctioned raw rgba: a modal backdrop overlay.
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.block,
    borderTopRightRadius: radius.block,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: { marginBottom: spacing.md },
});

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [rendered, setRendered] = useState(false);

  // Panel starts fully off-screen (or transparent, for reduced motion) so the
  // first paint never flashes the sheet in place before it animates.
  const translateY = useSharedValue(reduceMotion ? 0 : WINDOW_H);
  const panelOpacity = useSharedValue(reduceMotion ? 0 : 1);
  const backdropOpacity = useSharedValue(0);

  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Exit finished → unmount the Modal and notify the parent.
  const handleClosed = useCallback(() => {
    closingRef.current = false;
    setRendered(false);
    onCloseRef.current();
  }, []);

  // Play the exit, THEN close. Guarded so a drag + a prop change can't double-run.
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    backdropOpacity.value = withTiming(0, { duration: 160, easing: EASE_IN });
    if (reduceMotion) {
      panelOpacity.value = withTiming(0, { duration: 160 }, (finished) => {
        'worklet';
        if (finished) runOnJS(handleClosed)();
      });
    } else {
      translateY.value = withTiming(
        WINDOW_H,
        { duration: 220, easing: EASE_IN },
        (finished) => {
          'worklet';
          if (finished) runOnJS(handleClosed)();
        },
      );
    }
  }, [reduceMotion, handleClosed, backdropOpacity, panelOpacity, translateY]);

  // Mirror the controlled `visible` prop into internal mount state so the exit
  // animation can outlive `visible` going false.
  useEffect(() => {
    if (visible) {
      if (!rendered) setRendered(true);
    } else if (rendered && !closingRef.current) {
      close();
    }
  }, [visible, rendered, close]);

  // Entrance — runs once the Modal is actually mounted.
  useEffect(() => {
    if (!rendered) return;
    closingRef.current = false;
    backdropOpacity.value = withTiming(1, { duration: 140, easing: EASE_OUT });
    if (reduceMotion) {
      translateY.value = 0;
      panelOpacity.value = withTiming(1, { duration: 140, easing: EASE_OUT });
    } else {
      translateY.value = WINDOW_H;
      panelOpacity.value = 1;
      translateY.value = withSpring(0, SHEET_SPRING);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, reduceMotion]);

  // Drag-down to dismiss (native only; web falls back to backdrop tap).
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(10)
        .onUpdate((e) => {
          'worklet';
          translateY.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
            runOnJS(close)();
          } else {
            translateY.value = withSpring(0, SHEET_SPRING);
          }
        }),
    [close, translateY],
  );

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: panelOpacity.value,
  }));

  const panel = (
    <Animated.View
      accessibilityViewIsModal
      style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg }, panelStyle]}
    >
      <View style={styles.grabber} />
      {title ? (
        <AppText variant="title" style={styles.title}>
          {title}
        </AppText>
      ) : null}
      {children}
    </Animated.View>
  );

  return (
    <Modal
      visible={rendered}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.fill}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={close}
            style={[styles.backdrop, backdropStyle]}
          />
          {isNative ? <GestureDetector gesture={pan}>{panel}</GestureDetector> : panel}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
