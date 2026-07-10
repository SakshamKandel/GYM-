import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { SetLog, UnitPref } from '@gym/shared';
import { displayWeight } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { formatWeightNumber } from '../logic';

/**
 * One set row in the logger (Blocked language).
 * - logged → DONE = red-filled pill (black Oswald numbers + check), quiet RPE
 *   pill beside it, outlined PR stamp when earned (pills may carry strokes)
 * - current → raised rounded row, ghosted last-session numbers to beat
 * - future → dim target only
 * PR moment: one-time red fill flash (opacity 0→1→0, ~450ms, no loop) and
 * the PR tag scale-settles 1.15→1.0. A stamp, not confetti.
 */

interface Props {
  setNo: number;
  repRange: string | null;
  logged: SetLog | null;
  ghost: SetLog | null;
  isCurrent: boolean;
  flash: boolean;
  onFlashDone: () => void;
  unitPref: UnitPref;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  current: { backgroundColor: colors.surfaceRaised },
  setNo: {
    fontFamily: type.display,
    fontSize: 16,
    color: colors.textFaint,
    width: 28,
  },
  target: { flex: 1, marginLeft: spacing.sm },
  /** DONE state — red-filled pill, black ink (black-on-red brand law). */
  donePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 34,
  },
  doneNumbers: {
    fontFamily: type.display,
    fontSize: 20,
    color: colors.onBlock,
  },
  /** Quiet raised pill for the optional effort rating. */
  rpePill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  ghostNumbers: {
    fontFamily: type.display,
    fontSize: 26,
    color: colors.textFaint,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prTag: {
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  prTagText: {
    fontFamily: type.display,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  flashFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
});

function fmtSet(s: SetLog, unitPref: UnitPref): string {
  return `${formatWeightNumber(displayWeight(s.weightKg, unitPref))} × ${s.reps}`;
}

export function SetRow({
  setNo,
  repRange,
  logged,
  ghost,
  isCurrent,
  flash,
  onFlashDone,
  unitPref,
}: Props) {
  const flashOpacity = useSharedValue(0);
  const tagScale = useSharedValue(flash ? 1.15 : 1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!flash) return;
    // Reduced motion: skip the fill sweep + tag settle, land on the final
    // stamp immediately, and clear the one-shot flash flag.
    if (reduceMotion) {
      flashOpacity.value = 0;
      tagScale.value = 1;
      onFlashDone();
      return;
    }
    flashOpacity.value = withSequence(
      withTiming(1, { duration: 150 }),
      withTiming(0, { duration: 300 }, (finished) => {
        if (finished) runOnJS(onFlashDone)();
      }),
    );
    tagScale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.back(2)) });
    return () => cancelAnimation(flashOpacity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));
  const tagStyle = useAnimatedStyle(() => ({ transform: [{ scale: tagScale.value }] }));

  const targetText = repRange ? `${repRange} reps` : isCurrent || logged ? '' : 'open set';

  return (
    <View style={[styles.row, isCurrent && styles.current]}>
      {flash ? (
        <Animated.View pointerEvents="none" style={[styles.flashFill, flashStyle]} />
      ) : null}
      <AppText style={styles.setNo} tabular>
        {String(setNo)}
      </AppText>
      <View style={styles.target}>
        {targetText ? (
          <AppText variant="caption" color={colors.textDim} tabular>
            {targetText}
          </AppText>
        ) : null}
      </View>
      <View style={styles.right}>
        {logged ? (
          <>
            {logged.isPr ? (
              <Animated.View style={[styles.prTag, tagStyle]}>
                <AppText style={styles.prTagText} tabular={false}>
                  PR
                </AppText>
              </Animated.View>
            ) : null}
            {logged.rpe !== null ? (
              <View style={styles.rpePill}>
                <AppText variant="caption" color={colors.textDim} tabular>
                  {`RPE ${logged.rpe}`}
                </AppText>
              </View>
            ) : null}
            <View style={styles.donePill}>
              <AppText style={styles.doneNumbers} tabular>
                {fmtSet(logged, unitPref)}
              </AppText>
              <Ionicons name="checkmark" size={14} color={colors.onBlock} />
            </View>
          </>
        ) : isCurrent ? (
          <AppText style={styles.ghostNumbers} tabular>
            {ghost ? fmtSet(ghost, unitPref) : '— × —'}
          </AppText>
        ) : (
          <AppText variant="caption" color={colors.textFaint}>
            —
          </AppText>
        )}
      </View>
    </View>
  );
}
