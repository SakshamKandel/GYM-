import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Onboarding answer card: big tappable block, one per option, no typing
 * where a tap works. Block language: no borders — selected = solid red
 * block with BLACK ink (single-select, so at most one red block shows).
 */
interface Props {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    minHeight: 72,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  selected: { backgroundColor: colors.blockRed },
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
        <AppText variant="title" color={selected ? colors.onBlock : colors.text}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={selected ? colors.onBlock : colors.textDim}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}
