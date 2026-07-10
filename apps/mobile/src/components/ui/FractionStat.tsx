import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';

/**
 * Big Oswald fraction stat (REVAMP-BRIEF §4): numerator huge ("24"),
 * denominator small and dim ("/30"), baseline-aligned, with an optional
 * eyebrow label above. Set `onBlock` when it sits on a red/cream block —
 * ink flips to `colors.onBlock` (denominator at 0.6 opacity per the brief's
 * hero sketch; ≥3:1 on red for large text).
 */
interface Props {
  /** Numerator — the big number ("24"). */
  value: number | string;
  /** Denominator ("30" → rendered as "/30"). */
  total: number | string;
  /** Optional eyebrow above the fraction ("Sets this week"). */
  label?: string;
  /** On a red/cream block: use black ink. */
  onBlock?: boolean;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  denomOnBlock: { opacity: 0.6 },
});

export function FractionStat({ value, total, label, onBlock = false, style }: Props) {
  const ink = onBlock ? colors.onBlock : colors.text;
  const dim = onBlock ? colors.onBlock : colors.textDim;
  return (
    <View
      accessible
      accessibilityLabel={`${label ? `${label}: ` : ''}${value} of ${total}`}
      style={style}
    >
      {label ? (
        <AppText variant="label" color={dim}>
          {label}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <AppText variant="stat" color={ink} tabular>
          {value}
        </AppText>
        <AppText
          variant="title"
          color={dim}
          tabular
          style={onBlock ? styles.denomOnBlock : null}
        >
          {`/${total}`}
        </AppText>
      </View>
    </View>
  );
}
