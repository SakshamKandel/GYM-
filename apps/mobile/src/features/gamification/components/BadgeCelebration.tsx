import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, ReduceMotion, ZoomIn } from 'react-native-reanimated';
import type { BadgeDef } from '@gym/shared';
import { spacing } from '@gym/ui-tokens';
import { AppText, Button, Sheet } from '../../../components/ui';
import { BadgeMedal } from '../../../components/ui/badges/BadgeMedal';
import { PrCelebration } from '../../training/components/PrCelebration';
import { successHaptic } from '../../../lib/haptics';

/**
 * Restrained new-badge moment — the earned BadgeMedal lands center-stage with
 * a single spring scale-in (one-shot, reduced-motion aware, no loops), the
 * existing PR celebration particle burst plays ONCE behind it, and the sheet
 * names the badge. When a batch has more than one newly-earned badge the
 * sheet leads with the first and counts the rest — the burst and the spring
 * still play only once for the whole moment.
 *
 * Block-language layout (REVAMP-BRIEF §4/§5): centered eyebrow micro-label →
 * medal → the badge name as a big Oswald display title, uppercase. Same
 * sanctioned motion as before — nothing new animates, nothing loops.
 *
 * Strength-club badges start 'logged' — this celebrates the earning moment
 * regardless of verification status; verification gets its own quiet push
 * later, no separate celebration.
 */
interface Props {
  visible: boolean;
  badges: BadgeDef[];
  onClose: () => void;
}

const MEDAL_SIZE = 104;
const BURST_SIZE = 200;

// Matches Sheet's shortest own close timing (its backdrop/reduced-motion
// fade) so the medal and burst fade out alongside the sheet's dismiss instead
// of popping away the instant the sheet BEGINS closing — Sheet keeps its
// Modal mounted for its own ~160-220ms close, which is what makes this safe.
const SHEET_CLOSE_MS = 160;

export function BadgeCelebration({ visible, badges, onClose }: Props) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (visible && !firedRef.current) {
      firedRef.current = true;
      successHaptic();
    }
    if (!visible) firedRef.current = false;
  }, [visible]);

  if (badges.length === 0) return null;
  const [first, ...rest] = badges;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.stage}>
        <AppText variant="label" center>
          New badge earned
        </AppText>
        <View style={styles.medalStage}>
          <View style={styles.burstWrap} pointerEvents="none">
            {visible ? (
              <Animated.View exiting={FadeOut.duration(SHEET_CLOSE_MS)}>
                <PrCelebration onDone={() => {}} size={BURST_SIZE} />
              </Animated.View>
            ) : null}
          </View>
          {visible ? (
            <Animated.View
              key={first!.id}
              entering={ZoomIn.springify()
                .damping(14)
                .stiffness(160)
                .reduceMotion(ReduceMotion.System)}
              exiting={FadeOut.duration(SHEET_CLOSE_MS)}
            >
              <BadgeMedal badge={first!} status="logged" size={MEDAL_SIZE} />
            </Animated.View>
          ) : null}
        </View>
        <AppText variant="display" center style={styles.name}>
          {first!.name}
        </AppText>
        {rest.length > 0 ? (
          <AppText variant="caption" center>
            + {rest.length} more badge{rest.length === 1 ? '' : 's'}
          </AppText>
        ) : null}
      </View>
      <Button label="Nice" onPress={onClose} style={styles.doneBtn} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  // Fixed square so the absolute burst stays centered on the medal — holds
  // no text, so the fixed dimensions can't clip anything under font scaling.
  medalStage: {
    width: MEDAL_SIZE,
    height: MEDAL_SIZE,
  },
  burstWrap: {
    position: 'absolute',
    top: (MEDAL_SIZE - BURST_SIZE) / 2,
    left: (MEDAL_SIZE - BURST_SIZE) / 2,
  },
  name: { textTransform: 'uppercase' },
  doneBtn: { marginTop: spacing.sm },
});
