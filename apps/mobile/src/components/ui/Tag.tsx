import { StyleSheet, View } from 'react-native';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText } from './AppText';

/** Small Oswald caps tag: PR · UP NEXT · CURRENT · MOST POPULAR. */
interface Props {
  label: string;
  /** filled = solid accent block; outline = bordered. */
  variant?: 'filled' | 'outline' | 'dim';
  color?: string;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm - 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: type.display,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});

export function Tag({ label, variant = 'outline', color = colors.accent }: Props) {
  const bg =
    variant === 'filled' ? color : variant === 'dim' ? colors.surfaceRaised : 'transparent';
  const textColor =
    variant === 'filled' ? colors.onAccent : variant === 'dim' ? colors.textDim : color;
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: bg },
        variant === 'outline' && { borderWidth: 1.5, borderColor: color },
      ]}
    >
      <AppText style={[styles.text, { color: textColor }]} tabular={false} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}
