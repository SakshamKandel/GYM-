import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '@gym/ui-tokens';

/**
 * Rounded-square icon block (the reference's tile-chip motif) — used at the
 * start of list rows and inside tiles to give every row a visual anchor.
 */
interface Props {
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Chip background; defaults to raised surface. */
  color?: string;
  iconColor?: string;
  size?: number;
}

const styles = StyleSheet.create({
  chip: {
    // radius.md — the nested-tile radius of the block language (brief §3).
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function IconChip({
  icon,
  color = colors.surfaceRaised,
  iconColor = colors.text,
  size = 44,
}: Props) {
  return (
    <View style={[styles.chip, { width: size, height: size, backgroundColor: color }]}>
      <Ionicons name={icon} size={size * 0.48} color={iconColor} />
    </View>
  );
}
