import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import { AppText, Card, Tag } from '../../../components/ui';
import { MealThumb } from './MealThumb';
import { orderItemsSummary, windowName } from './orderView';
import { orderStatusLabel, orderStatusTone, paymentStatusLabel } from '../logic';
import type { MealOrder } from '../api';

/**
 * Compact past-order row — a meal thumbnail treatment, the partner + item
 * summary, a status Tag and total, chevroning into the detail sheet. Grouped
 * by delivery date on the orders screen.
 */

const TONE_COLOR: Record<'accent' | 'success' | 'error' | 'dim', string> = {
  accent: colors.accent,
  success: colors.success,
  error: colors.error,
  dim: colors.textDim,
};

interface Props {
  order: MealOrder;
  partnerName?: string;
  onOpen: (order: MealOrder) => void;
}

export function OrderHistoryCard({ order, partnerName, onOpen }: Props) {
  const tone = orderStatusTone(order.status);
  return (
    <Card
      padding={spacing.md}
      onPress={() => onOpen(order)}
      accessibilityLabel={`${orderStatusLabel(order.status)} ${windowName(order.window)} order from ${
        partnerName ?? 'your partner'
      }, ${formatMoney(order.totalMinor, order.currency)} — view details`}
      style={styles.card}
    >
      <View style={styles.row}>
        <MealThumb size={52} />
        <View style={styles.main}>
          <View style={styles.topLine}>
            <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
              {partnerName ?? windowName(order.window)}
            </AppText>
            <Tag label={orderStatusLabel(order.status)} variant="outline" color={TONE_COLOR[tone]} />
          </View>
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {orderItemsSummary(order)}
          </AppText>
          <View style={styles.bottomLine}>
            <AppText variant="bodyBold" tabular>
              {formatMoney(order.totalMinor, order.currency)}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              {windowName(order.window)} · {paymentStatusLabel(order)}
            </AppText>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  main: { flex: 1, gap: 3 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { flex: 1 },
  bottomLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
});
