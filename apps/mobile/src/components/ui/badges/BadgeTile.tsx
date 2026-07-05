import { StyleSheet, View } from 'react-native';
import type { BadgeIconKey } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../AppText';
import { PressableScale } from '../PressableScale';
import { BadgeGlyph, VerifiedCheckGlyph } from './glyphs';

/**
 * One badge cell in the grid: locked = charcoal outline glyph on a dim tile,
 * earned = red-filled tile with the glyph in charcoal, verified = earned plus
 * a small check overlay badge (coach-verified strength clubs). Flat, no
 * glow/gradients — matches the app's icon language.
 */
export type BadgeTileStatus = 'locked' | 'logged' | 'verified';

interface Props {
  icon: BadgeIconKey;
  name: string;
  status: BadgeTileStatus;
  onPress?: () => void;
  size?: number;
}

const TILE_SIZE = 76;

export function BadgeTile({ icon, name, status, onPress, size = TILE_SIZE }: Props) {
  const earned = status !== 'locked';
  const glyphSize = size * 0.42;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        status === 'verified'
          ? `${name}, verified`
          : status === 'logged'
            ? name
            : `${name}, locked`
      }
      onPress={onPress}
      style={styles.wrap}
    >
      <View
        style={[
          styles.tile,
          { width: size, height: size },
          earned ? styles.tileEarned : styles.tileLocked,
        ]}
      >
        <BadgeGlyph icon={icon} size={glyphSize} color={earned ? colors.bg : colors.textFaint} />
        {status === 'verified' ? (
          <View style={styles.checkBadge}>
            <VerifiedCheckGlyph size={11} color={colors.onAccent} />
          </View>
        ) : null}
      </View>
      <AppText
        variant="caption"
        center
        numberOfLines={2}
        style={earned ? undefined : styles.nameLocked}
      >
        {name}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs, width: TILE_SIZE + spacing.md },
  tile: {
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLocked: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  tileEarned: {
    backgroundColor: colors.accent,
  },
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
  nameLocked: { color: colors.textFaint },
});

// Re-export the shared type name so screens can import from one place.
export type { BadgeIconKey };
