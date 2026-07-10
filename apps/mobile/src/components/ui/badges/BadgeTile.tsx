import { StyleSheet, View } from 'react-native';
import type { BadgeDef, BadgeIconKey } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../AppText';
import { PressableScale } from '../PressableScale';
import { BadgeMedal } from './BadgeMedal';
import { VerifiedCheckGlyph } from './glyphs';

/**
 * One badge cell in the grid: a BadgeMedal silhouette (tiered metal hexagon
 * for strength clubs, red enamel medal elsewhere) with the name below.
 * Locked medals render engraved-charcoal and, for threshold badges, carry a
 * small progress bar. Verified adds the green check chip on top of the
 * medal's gold laurel (coach-verified strength clubs).
 *
 * Block language note: tiles sit directly on the near-black canvas — the
 * chunky medal IS the block. No card fill behind them, ever: locked medals
 * engrave in `colors.surface` and would vanish inside a charcoal container
 * (badges screen contract).
 */
export type BadgeTileStatus = 'locked' | 'logged' | 'verified';

interface Props {
  badge: BadgeDef;
  status: BadgeTileStatus;
  onPress?: () => void;
  size?: number;
  /** 0..1 toward the threshold, shown inside locked medals. Null hides it. */
  progress?: number | null;
}

const TILE_SIZE = 76;

export function BadgeTile({ badge, status, onPress, size = TILE_SIZE, progress = null }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        status === 'verified'
          ? `${badge.name}, verified`
          : status === 'logged'
            ? badge.name
            : `${badge.name}, locked`
      }
      onPress={onPress}
      style={styles.wrap}
    >
      <View style={{ width: size, height: size }}>
        <BadgeMedal badge={badge} status={status} size={size} progress={progress} />
        {status === 'verified' ? (
          <View style={styles.checkBadge}>
            <VerifiedCheckGlyph size={11} color={colors.onAccent} />
          </View>
        ) : null}
      </View>
      {/* Caption's default textDim holds ≥4.5:1 on the canvas even for locked
          tiles — the engraved medal already carries the locked state, so the
          name never drops to the (failing-contrast) faint ramp. */}
      <AppText variant="caption" center numberOfLines={2}>
        {badge.name}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs, width: TILE_SIZE + spacing.md },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Re-export the shared type name so screens can import from one place.
export type { BadgeIconKey };
