import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BadgeDef } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, Sheet } from '../../../components/ui';
import { BadgeGlyph } from '../../../components/ui/badges/glyphs';
import { PrCelebration } from '../../training/components/PrCelebration';
import { successHaptic } from '../../../lib/haptics';

/**
 * Restrained new-badge moment — reuses the existing PR celebration's particle
 * burst ONCE (no loop, no repeated bursts per badge in a batch) behind a
 * simple sheet naming the badge just earned. Mounted from the Badges screen,
 * keyed on the first id of the current `newlyEarnedIds` batch; when a batch
 * has more than one newly-earned badge, the sheet just lists all of them —
 * the burst still plays only once for the whole moment.
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
    <Sheet visible={visible} onClose={onClose} title="New badge earned">
      <View style={styles.burstWrap} pointerEvents="none">
        {visible ? <PrCelebration onDone={() => {}} size={160} /> : null}
      </View>
      <View style={styles.badgeRow}>
        <View style={styles.glyphTile}>
          <BadgeGlyph icon={first!.icon} size={34} color={colors.bg} />
        </View>
        <View style={styles.info}>
          <AppText variant="title">{first!.name}</AppText>
          {rest.length > 0 ? (
            <AppText variant="caption">+ {rest.length} more badge{rest.length === 1 ? '' : 's'}</AppText>
          ) : null}
        </View>
      </View>
      <Button label="Nice" onPress={onClose} style={styles.doneBtn} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  burstWrap: {
    position: 'absolute',
    top: -20,
    alignSelf: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  glyphTile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  doneBtn: { marginTop: spacing.sm },
});
