import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Tag } from '../../../components/ui';
import { posterDate } from '../../../lib/dates';
import type { ProgressPhoto } from './api';

/**
 * Before/after drag slider (Pack O: "photo compare"). The AFTER photo fills
 * the frame; the BEFORE photo sits on top, clipped to a draggable divider —
 * classic reveal-by-drag comparison. Pure gesture-handler + reanimated
 * (same combo already used by Stepper/Sheet), no extra dependency.
 */

interface Props {
  before: ProgressPhoto;
  after: ProgressPhoto;
}

const ASPECT = 4 / 5;
const HANDLE_SIZE = 40;

export function PhotoCompareSlider({ before, after }: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const dividerX = useSharedValue(0);
  const startX = useSharedValue(0);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = dividerX.value;
    })
    .onUpdate((e) => {
      const next = startX.value + e.translationX;
      dividerX.value = Math.max(0, Math.min(containerWidth, next));
    });

  const clipStyle = useAnimatedStyle(() => ({
    width: containerWidth > 0 ? dividerX.value : '50%',
  }));
  const handleStyle = useAnimatedStyle(() => ({
    left: (containerWidth > 0 ? dividerX.value : containerWidth / 2) - HANDLE_SIZE / 2,
  }));

  return (
    <View style={styles.wrap}>
      <View
        style={styles.frame}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setContainerWidth(w);
          // Start centered the first time we learn the real width.
          if (dividerX.value === 0) dividerX.value = w / 2;
        }}
      >
        {/* AFTER — fills the frame, sits underneath. */}
        <Image
          source={{ uri: after.url }}
          cachePolicy="none"
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          accessibilityLabel={`After photo from ${posterDate(after.takenOn)}`}
        />
        <View style={styles.afterChip}>
          <Tag label="After" variant="filled" />
        </View>

        {/* BEFORE — clipped to the divider, sits on top. */}
        {containerWidth > 0 ? (
          <Animated.View style={[styles.beforeClip, clipStyle]}>
            <Image
              source={{ uri: before.url }}
              cachePolicy="none"
              contentFit="cover"
              style={[styles.beforeImage, { width: containerWidth }]}
              accessibilityLabel={`Before photo from ${posterDate(before.takenOn)}`}
            />
            <View style={styles.beforeChip}>
              <Tag label="Before" variant="dim" />
            </View>
          </Animated.View>
        ) : null}

        {/* Divider handle — drag left/right to reveal more of either photo. */}
        {containerWidth > 0 ? (
          <GestureDetector gesture={pan}>
            <Animated.View
              style={[styles.handle, handleStyle]}
              accessibilityRole="adjustable"
              accessibilityLabel="Drag to compare before and after photos"
            >
              <View style={styles.handleLine} />
              <View style={styles.handleKnob} />
            </Animated.View>
          </GestureDetector>
        ) : null}
      </View>

      <View style={styles.datesRow}>
        <AppText variant="caption" color={colors.textDim}>
          {posterDate(before.takenOn)}
        </AppText>
        <AppText variant="caption" color={colors.textDim}>
          {posterDate(after.takenOn)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  frame: {
    width: '100%',
    aspectRatio: ASPECT,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  beforeClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  beforeImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
  },
  afterChip: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  beforeChip: { position: 'absolute', top: spacing.sm, left: spacing.sm },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleLine: {
    position: 'absolute',
    width: 2,
    top: 0,
    bottom: 0,
    backgroundColor: colors.onBlock,
    opacity: 0.9,
  },
  handleKnob: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.onBlock,
  },
  datesRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
