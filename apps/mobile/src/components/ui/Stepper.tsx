import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import { AndroidHaptics, performAndroidHapticsAsync } from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, radius, touch, type } from '@gym/ui-tokens';
import { tapHaptic } from '../../lib/haptics';
import { AppText } from './AppText';

/**
 * Weight/rep stepper — the anti-keyboard (research: system keyboards are slow,
 * two-handed, and hostile to chalky hands). 48dp targets, long-press repeats,
 * AND drag-to-change: slide the value left/right for fast adjustments.
 */
interface Props {
  value: number;
  onChange: (next: number) => void;
  step: number;
  min?: number;
  max?: number;
  /** Renders the value; default shows it as-is. */
  format?: (v: number) => string;
  label?: string;
  big?: boolean;
}

/** Pixels of drag needed to move one step — tuned for thumb-friendly swiping. */
const PX_PER_STEP = 24;

/**
 * Shortest gap between two ticks. A fast drag can cross several steps in
 * consecutive frames and the long-press repeat fires every 130ms: one tick per
 * value change reads as feedback, a continuous buzz reads as a fault.
 */
const HAPTIC_MIN_GAP_MS = 45;
/** Module-level: only one stepper is ever under a thumb at a time. */
let lastHapticAt = 0;

/**
 * One tick of feedback for a value change, and silent when the phone says so.
 *
 * Android goes through the view's own haptic feedback, which respects the
 * system touch-feedback setting (the impact API drives the vibrator directly
 * and would ignore it). iOS feedback generators already fall silent when
 * System Haptics is off, so the shared tap helper is the right call there. Web
 * has neither and no-ops.
 */
function stepHaptic(): void {
  const now = Date.now();
  if (now - lastHapticAt < HAPTIC_MIN_GAP_MS) return;
  lastHapticAt = now;
  if (Platform.OS === 'android') {
    void performAndroidHapticsAsync(AndroidHaptics.Clock_Tick).catch(() => undefined);
    return;
  }
  tapHaptic();
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Block language: filled circular +/- buttons — fill contrast, no strokes.
  btn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  btnPressed: { backgroundColor: colors.surfacePressed, transform: [{ scale: 0.96 }] },
  btnText: { fontFamily: type.bodySemiBold, fontSize: 22, color: colors.text, lineHeight: 24 },
  valueBox: {
    minWidth: 96,
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  valueBoxDragging: {
    backgroundColor: colors.surfaceRaised,
  },
  dragHint: {
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textFaint,
    marginTop: 2,
  },
});

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export function Stepper({ value, onChange, step, min = 0, max, format, label, big }: Props) {
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveValue = useRef(value);
  liveValue.current = value;
  const [dragging, setDragging] = useState(false);

  function apply(delta: number): void {
    let next = round(liveValue.current + delta);
    if (next < min) next = min;
    if (max !== undefined && next > max) next = max;
    if (next !== liveValue.current) {
      onChange(next);
      liveValue.current = next;
      // Only when the number actually moved: sitting on the min or the max
      // must feel like nothing happening, because nothing did.
      stepHaptic();
    }
  }

  function startRepeat(delta: number): void {
    stopRepeat();
    repeatTimer.current = setInterval(() => apply(delta), 130);
  }

  function stopRepeat(): void {
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }

  // Guarantee the long-press interval is torn down if the component unmounts
  // mid-press (navigation, auto-dismiss, list removal) — otherwise onPressOut
  // never fires and apply()->onChange() keeps mutating the parent forever.
  useEffect(() => () => stopRepeat(), []);

  // ── Drag-to-change via react-native-gesture-handler ──────────
  // PanResponder loses the responder war against ScrollViews on Android;
  // a RNGH Pan with activeOffsetX/failOffsetY negotiates correctly:
  // horizontal drags claim the gesture, vertical drags stay with the scroll.
  const dragAccum = useRef(0);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-10, 10])
        .runOnJS(true)
        .onStart(() => {
          dragAccum.current = 0;
          setDragging(true);
        })
        .onUpdate((e) => {
          const delta = e.translationX - dragAccum.current;
          const steps = Math.trunc(delta / PX_PER_STEP);
          if (steps !== 0) {
            dragAccum.current += steps * PX_PER_STEP;
            apply(steps * step);
          }
        })
        .onEnd(() => setDragging(false))
        .onFinalize(() => {
          stopRepeat();
          setDragging(false);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, min, max],
  );

  const display = format ? format(value) : String(round(value));

  return (
    <View style={styles.root}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label ?? 'value'} by ${step}`}
          onPress={() => apply(-step)}
          onLongPress={() => startRepeat(-step)}
          onPressOut={stopRepeat}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <AppText style={styles.btnText} tabular={false}>−</AppText>
        </Pressable>
        <GestureDetector gesture={pan}>
          <View
            style={[styles.valueBox, dragging && styles.valueBoxDragging]}
            accessibilityRole="adjustable"
            accessibilityLabel={`${label ?? 'value'} is ${display}. Swipe up or down to adjust.`}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e: AccessibilityActionEvent) => {
              if (e.nativeEvent.actionName === 'increment') apply(step);
              else if (e.nativeEvent.actionName === 'decrement') apply(-step);
            }}
          >
            <AppText variant={big ? 'stat' : 'display'} tabular>
              {display}
            </AppText>
            {/* Say that the value can be dragged everywhere it can be, not
                just on the oversized ones. The compact stepper is the one in
                the set logger, where sliding to the weight beats forty taps. */}
            <AppText style={styles.dragHint}>← drag →</AppText>
          </View>
        </GestureDetector>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label ?? 'value'} by ${step}`}
          onPress={() => apply(step)}
          onLongPress={() => startRepeat(step)}
          onPressOut={stopRepeat}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <AppText style={styles.btnText} tabular={false}>+</AppText>
        </Pressable>
      </View>
    </View>
  );
}
