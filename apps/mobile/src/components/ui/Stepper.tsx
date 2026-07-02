import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, radius, touch, type } from '@gym/ui-tokens';
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

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  btnPressed: { backgroundColor: colors.surfacePressed, transform: [{ scale: 0.96 }] },
  btnText: { fontFamily: type.bodySemiBold, fontSize: 22, color: colors.text, lineHeight: 24 },
  valueBox: {
    minWidth: 96,
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  valueBoxDragging: {
    backgroundColor: colors.surface,
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
        .onFinalize(() => setDragging(false)),
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
            accessibilityLabel={`${label ?? 'value'} is ${display}. Drag left or right to adjust.`}
          >
            <AppText variant={big ? 'stat' : 'display'} tabular>
              {display}
            </AppText>
            {big ? <AppText style={styles.dragHint}>← drag →</AppText> : null}
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
