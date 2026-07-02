import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Onboarding answer card: big tappable block, one per option, no typing
 * where a tap works. Selected = lime border + lime title (no glow).
 */
interface Props {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    minHeight: 72,
    justifyContent: 'center',
    gap: 4,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
});

export function OptionCard({ title, subtitle, selected, onPress }: Props) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.card, selected && styles.selected]}
    >
      <View>
        <AppText variant="title" color={selected ? colors.accent : colors.text}>
          {title}
        </AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
    </PressableScale>
  );
}
