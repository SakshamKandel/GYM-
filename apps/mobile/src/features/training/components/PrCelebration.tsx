import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Circle, Group } from '@shopify/react-native-skia';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors } from '@gym/ui-tokens';

/**
 * One-shot PR burst — a ring of accent particles flung outward and faded as
 * the row's PR tag settles in. Purely decorative (the PR is already recorded
 * by the tag + haptic), so reduced motion skips it entirely and resolves
 * onDone immediately rather than offering a static substitute.
 *
 * Mount this once per PR (key it on the set id so a fresh PR restarts clean)
 * and unmount it from onDone.
 */

interface Props {
  onDone: () => void;
  /** Canvas is a `size`×`size` square, centered by the caller. */
  size?: number;
}

const DURATION_MS = 750;
const COUNT = 10;
const RING_COLORS = [colors.accent, colors.text];

const PARTICLES = Array.from({ length: COUNT }, (_, i) => ({
  angle: (i / COUNT) * Math.PI * 2,
  distance: 46 + (i % 3) * 10,
  radius: 3 + (i % 3),
  color: RING_COLORS[i % RING_COLORS.length]!,
}));

function Particle({
  t,
  angle,
  distance,
  radius,
  color,
  center,
}: {
  t: SharedValue<number>;
  angle: number;
  distance: number;
  radius: number;
  color: string;
  center: number;
}) {
  const cx = useDerivedValue(() => center + Math.cos(angle) * distance * t.value);
  const cy = useDerivedValue(() => center + Math.sin(angle) * distance * t.value);
  const r = useDerivedValue(() => radius * (1 - t.value * 0.4));
  const opacity = useDerivedValue(() => 1 - t.value);

  return <Circle cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
}

export function PrCelebration({ onDone, size = 140 }: Props) {
  const t = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const center = size / 2;

  useEffect(() => {
    if (reduceMotion) {
      onDone();
      return;
    }
    t.value = withTiming(1, { duration: DURATION_MS, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    // Runs once per mount — callers remount (key change) to replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reduceMotion) return null;

  return (
    <Canvas style={[styles.canvas, { width: size, height: size }]}>
      <Group>
        {PARTICLES.map((p, i) => (
          <Particle
            key={i}
            t={t}
            angle={p.angle}
            distance={p.distance}
            radius={p.radius}
            color={p.color}
            center={center}
          />
        ))}
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: {
    // Positioning is the caller's job — this is just the drawing surface.
  },
});
