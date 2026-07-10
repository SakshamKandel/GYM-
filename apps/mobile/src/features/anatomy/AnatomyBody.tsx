import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Chip } from '../../components/ui';
import { tapHaptic } from '../../lib/haptics';
import {
  MUSCLE_LABELS,
  SOURCE_MUSCLES,
  SOURCE_TO_APP_MUSCLE,
  VISUAL_ONLY_SLUGS,
  type MuscleGroup,
} from '../../lib/muscleMap';
import { MALE_MUSCLE_MAP, MUSCLE_MAP_VIEW_BOX, type MuscleMapSide } from '../../lib/muscleMapData';

/**
 * Rotatable anatomy body. Drag horizontally to spin the figure around its
 * vertical axis (perspective rotateY): the silhouette narrows edge-on and the
 * anatomically drawn front/back faces swap at the 90° crossings, so turning
 * feels like walking around a person. Pinch zooms 1–2.5×; double-tap resets.
 * Tap a muscle to select it. Reduced motion: rotation snaps without springs
 * and the Front/Back chips remain as a non-gestural alternative.
 *
 * The back face is pre-mirrored (scaleX −1) so the container's rotateY(180°)
 * cancels the mirror and the back view reads exactly as drawn.
 */

interface Props {
  selected: MuscleGroup | null;
  onSelect: (muscle: MuscleGroup) => void;
  /** Which face to show when selection changes programmatically. */
  side: MuscleMapSide;
  onSideSettled?: (side: MuscleMapSide) => void;
  /** Body render height; width follows the SVG aspect. */
  height?: number;
}

const BODY_W_RATIO = 194 / 340;
/** Degrees of rotation per horizontal pixel of drag. */
const DEG_PER_PX = 0.6;
const SNAP_SPRING = { damping: 20, stiffness: 160, mass: 0.9 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backfaceVisibility: 'hidden',
  },
  hintWrap: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
  },
  sideChips: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  selectedLabel: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    alignItems: 'flex-end',
  },
});

function BodyFace({
  side,
  selected,
  onSelect,
}: {
  side: MuscleMapSide;
  selected: MuscleGroup | null;
  onSelect: (muscle: MuscleGroup) => void;
}) {
  const highlighted = new Set(selected ? SOURCE_MUSCLES[selected] : []);

  return (
    <Svg
      width="100%"
      height="100%"
      viewBox={MUSCLE_MAP_VIEW_BOX[side]}
      accessibilityLabel={
        selected
          ? `${side} body view. ${MUSCLE_LABELS[selected]} highlighted.`
          : `${side} body view.`
      }
    >
      {MALE_MUSCLE_MAP[side].flatMap((group) =>
        group.paths.map((path, index) => {
          const mappedMuscle = SOURCE_TO_APP_MUSCLE[group.slug];
          const selectable = mappedMuscle !== undefined && !VISUAL_ONLY_SLUGS.has(group.slug);
          const active = highlighted.has(group.slug);
          return (
            <Path
              key={`${group.slug}-${index}`}
              d={path}
              fill={active ? colors.accent : colors.surfaceRaised}
              stroke={active ? colors.onAccent : colors.borderStrong}
              strokeWidth={active ? 3.2 : 1.6}
              onPress={
                selectable
                  ? () => {
                      tapHaptic();
                      onSelect(mappedMuscle);
                    }
                  : undefined
              }
              accessible={selectable}
              accessibilityLabel={
                selectable ? `Select ${MUSCLE_LABELS[mappedMuscle]}` : undefined
              }
            />
          );
        }),
      )}
    </Svg>
  );
}

export function AnatomyBody({ selected, onSelect, side, onSideSettled, height = 420 }: Props) {
  const reduceMotion = useReducedMotion();
  // Continuous rotation in degrees. 0 = front facing, 180 = back facing.
  const rotation = useSharedValue(side === 'front' ? 0 : 180);
  const rotationStart = useSharedValue(0);
  const zoom = useSharedValue(1);
  const zoomStart = useSharedValue(1);
  // Which face the JS side considers "showing" — drives the side chips.
  const [visibleSide, setVisibleSide] = useState<MuscleMapSide>(side);

  const width = Math.round(height * BODY_W_RATIO);

  const settle = (deg: number): void => {
    'worklet';
    // Snap to the nearest face: multiples of 180.
    const target = Math.round(deg / 180) * 180;
    rotation.value = withSpring(target, SNAP_SPRING);
  };

  // Programmatic side change (chip tap / preferred side on selection): settle
  // on the nearest face, then a half turn lands on the other face.
  const rotateToSide = (next: MuscleMapSide): void => {
    const current = rotation.value;
    const facingFront = Math.cos((current * Math.PI) / 180) >= 0;
    if ((next === 'front') === facingFront) return;
    const target = Math.round(current / 180) * 180 + 180;
    rotation.value = reduceMotion ? target : withSpring(target, SNAP_SPRING);
  };

  // Selecting a muscle from the chip strip flips the body to the face that
  // shows it best.
  useEffect(() => {
    if (side !== visibleSide) rotateToSide(side);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rotate only when the requested side changes
  }, [side]);

  useAnimatedReaction(
    () => Math.cos((rotation.value * Math.PI) / 180) >= 0,
    (isFront, prev) => {
      if (prev === null || isFront !== prev) {
        const next: MuscleMapSide = isFront ? 'front' : 'back';
        runOnJS(setVisibleSide)(next);
        if (onSideSettled) runOnJS(onSideSettled)(next);
      }
    },
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-16, 16])
    .onStart(() => {
      rotationStart.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = rotationStart.value + e.translationX * DEG_PER_PX;
    })
    .onEnd((e) => {
      // Carry a bit of fling velocity into the snap decision.
      const projected = rotation.value + e.velocityX * DEG_PER_PX * 0.08;
      settle(projected);
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      zoomStart.value = zoom.value;
    })
    .onUpdate((e) => {
      zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomStart.value * e.scale));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      zoom.value = withSpring(1, SNAP_SPRING);
      settle(rotation.value);
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { scale: zoom.value },
      { rotateY: `${rotation.value}deg` },
    ],
  }));

  // Depth cue: the figure dims as it turns edge-on.
  const frontStyle = useAnimatedStyle(() => {
    const c = Math.cos((rotation.value * Math.PI) / 180);
    return { opacity: c > 0 ? Math.min(1, 0.35 + c) : 0 };
  });
  const backStyle = useAnimatedStyle(() => {
    const c = Math.cos((rotation.value * Math.PI) / 180);
    return {
      opacity: c < 0 ? Math.min(1, 0.35 - c) : 0,
      transform: [{ scaleX: -1 }],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.panel, { height }]} accessible={false}>
        <Animated.View style={[{ width, height: height - spacing.gutter * 2 }, bodyStyle]}>
          <Animated.View style={[styles.face, frontStyle]}>
            <BodyFace side="front" selected={selected} onSelect={onSelect} />
          </Animated.View>
          <Animated.View style={[styles.face, backStyle]}>
            <BodyFace side="back" selected={selected} onSelect={onSelect} />
          </Animated.View>
        </Animated.View>

        <View style={styles.sideChips}>
          <Chip
            label="Front"
            selected={visibleSide === 'front'}
            onPress={() => rotateToSide('front')}
          />
          <Chip
            label="Back"
            selected={visibleSide === 'back'}
            onPress={() => rotateToSide('back')}
          />
        </View>

        <View style={styles.hintWrap} pointerEvents="none">
          <AppText variant="caption" color={colors.textFaint}>
            Drag to rotate · pinch to zoom
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
      </View>
    </GestureDetector>
  );
}
