import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '@gym/ui-tokens';
import { PressableScale } from './PressableScale';

/** Signal-red circular action button — black icon on red, no shadow. */
interface Props {
  icon?: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
}

const styles = StyleSheet.create({
  fab: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function Fab({ icon = 'add', onPress, accessibilityLabel, size = 72 }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[styles.fab, { width: size, height: size }]}
    >
      <Ionicons name={icon} size={size * 0.45} color={colors.onBlock} />
    </PressableScale>
  );
}
