import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SetLog, UnitPref } from '@gym/shared';
import { displayWeight } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { formatWeightNumber } from '../logic';

/**
 * One set row in the logger.
 * - logged → committed numbers (Oswald 26) + subtle check, PR tag when earned
 * - current → raised, ghosted last-session numbers to beat (textFaint)
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

const useNative = Platform.OS !== 'web';

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
  numbers: {
    fontFamily: type.display,
    fontSize: 26,
    color: colors.text,
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
    borderRadius: radius.sm - 6,
    paddingHorizontal: 6,
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
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const tagScale = useRef(new Animated.Value(flash ? 1.15 : 1)).current;

  useEffect(() => {
    if (!flash) return;
    const seq = Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 1, duration: 150, useNativeDriver: useNative }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: useNative }),
    ]);
    seq.start(() => onFlashDone());
    Animated.timing(tagScale, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.back(2)),
      useNativeDriver: useNative,
    }).start();
    return () => seq.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  const targetText = repRange ? `${repRange} reps` : isCurrent || logged ? '' : 'open set';

  return (
    <View style={[styles.row, isCurrent && styles.current]}>
      {flash ? (
        <Animated.View pointerEvents="none" style={[styles.flashFill, { opacity: flashOpacity }]} />
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
              <Animated.View style={[styles.prTag, { transform: [{ scale: tagScale }] }]}>
                <AppText style={styles.prTagText} tabular={false}>
                  PR
                </AppText>
              </Animated.View>
            ) : null}
            <AppText style={styles.numbers} tabular>
              {fmtSet(logged, unitPref)}
            </AppText>
            <Ionicons name="checkmark" size={16} color={colors.textDim} />
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
