import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { formatMoney } from '@gym/shared';
import {
  AppText,
  Button,
  Card,
  enterFade,
  enterUp,
  Screen,
  ScreenHeader,
  SkeletonRow,
} from '../../components/ui';
import { useAuth } from '../../state/auth';
import { fetchMealOrderReceipt, toMealsError, type MealOrderReceipt } from '../../features/meals/api';
import { mealErrorMessage } from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';

/**
 * /meals/order-confirmation?orderId= — the post-purchase "you're taken care
 * of" screen every order flow was missing (Pack A / T1): order number, an
 * itemized receipt, and "what happens next" copy — replacing the silent
 * redirect straight to the tracker. Reachable again later from Orders → the
 * order's detail sheet's Receipt action, so nav-away never strands it.
 *
 * Visual language (2026-07-21 professional pass): the screen's single red
 * hero block celebrates the placement (check medallion + oversized Oswald
 * order number), followed by a receipt-style fee card and numbered
 * what-happens-next steps.
 */

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg, alignItems: 'center' },
  hero: { alignItems: 'center', gap: spacing.sm },
  heroCheck: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.onBlock,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontFamily: type.display,
    fontSize: type.size.heading,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  orderNumberPill: {
    backgroundColor: colors.onBlock,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  orderNumberText: {
    fontFamily: type.display,
    fontSize: 22,
    letterSpacing: 1.5,
    color: colors.text,
  },
  heroCopy: { textAlign: 'center', marginTop: spacing.xs },
  card: { gap: spacing.sm, marginTop: spacing.lg },
  cardLabel: { marginBottom: spacing.xs },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: colors.borderStrong, marginVertical: spacing.sm },
  totalValue: { fontFamily: type.display, fontSize: 26, color: colors.text, letterSpacing: 0.5 },
  whatNext: { gap: spacing.md, marginTop: spacing.xl },
  whatNextRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumberText: { fontFamily: type.display, fontSize: 14, color: colors.accent },
  buttonRow: { gap: spacing.sm, marginTop: spacing.xl },
  skeletons: { gap: spacing.md, marginTop: spacing.gutter },
  skeletonRow: { backgroundColor: colors.surface, borderRadius: radius.block, padding: spacing.lg, height: 96 },
});

function whatNextCopy(receipt: MealOrderReceipt): string[] {
  if (receipt.status === 'cancelled' || receipt.status === 'refused') {
    return ["This order was cancelled — you won't be charged for it."];
  }
  const lines = ["The partner has your order and will confirm it shortly."];
  if (receipt.timeline.some((t) => t.status === 'confirmed')) {
    lines[0] = 'The partner has confirmed your order.';
  }
  lines.push('Track live status any time from My orders.');
  return lines;
}

export default function OrderConfirmationScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const token = useAuth((s) => s.token);
  const [receipt, setReceipt] = useState<MealOrderReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !orderId) return;
    void (async () => {
      try {
        const r = await fetchMealOrderReceipt(token, orderId);
        setReceipt(r);
      } catch (err) {
        setError(mealErrorMessage(toMealsError(err).code));
      }
    })();
  }, [token, orderId]);

  function shareReceipt(): void {
    if (!receipt) return;
    const lines = receipt.items.map(
      (item) => `${item.qty}x ${item.name} — ${formatMoney(item.priceMinorSnapshot * item.qty, receipt.currency)}`,
    );
    const message = [`Order ${receipt.orderNumber}`, ...lines, `Total: ${formatMoney(receipt.totalMinor, receipt.currency)}`].join(
      '\n',
    );
    void Share.share({ message, title: `Order ${receipt.orderNumber}` });
  }

  if (!orderId) {
    return (
      <Screen scroll>
        <ScreenHeader eyebrow="Meals" title="Order placed" style={styles.header} />
        <AppText variant="body" center>
          No order to show.
        </AppText>
        <Button label="Back to meals" onPress={() => replacePath('/meals')} style={styles.buttonRow} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterUp(0)}>
        <Card variant="red" style={styles.hero}>
          <View style={styles.heroCheck} accessible={false} importantForAccessibility="no-hide-descendants">
            <Ionicons name="checkmark" size={40} color={colors.blockRed} />
          </View>
          <AppText style={styles.heroTitle} color={colors.onBlock}>
            Order placed
          </AppText>
          {receipt ? (
            <View style={styles.orderNumberPill}>
              <AppText style={styles.orderNumberText} tabular>
                {receipt.orderNumber}
              </AppText>
            </View>
          ) : null}
          <AppText variant="caption" color={colors.onBlock} style={styles.heroCopy}>
            {receipt ? 'Show this number if the kitchen asks.' : 'Preparing your receipt…'}
          </AppText>
        </Card>
      </Animated.View>

      {error ? (
        <Animated.View entering={enterFade(0)}>
          <AppText variant="body" color={colors.error} center>
            {error}
          </AppText>
        </Animated.View>
      ) : !receipt ? (
        <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading your receipt">
          {Array.from({ length: 2 }, (_, i) => (
            <SkeletonRow key={i} style={styles.skeletonRow} />
          ))}
        </Animated.View>
      ) : (
        <>
          <Animated.View entering={enterUp(1)}>
            <Card style={styles.card}>
              <AppText variant="label" color={colors.textDim} style={styles.cardLabel}>
                Receipt
              </AppText>
              {receipt.items.map((item) => (
                <View key={item.name} style={styles.itemRow}>
                  <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {item.qty}× {item.name}
                  </AppText>
                  <AppText variant="body" tabular>
                    {formatMoney(item.priceMinorSnapshot * item.qty, receipt.currency)}
                  </AppText>
                </View>
              ))}
              <View style={styles.divider} />
              <View style={styles.feeRow}>
                <AppText variant="body" color={colors.textDim}>
                  Delivery
                </AppText>
                <AppText variant="body" tabular color={receipt.deliveryFeeMinor === 0 ? colors.success : colors.text}>
                  {receipt.deliveryFeeMinor === 0 ? 'Free' : formatMoney(receipt.deliveryFeeMinor, receipt.currency)}
                </AppText>
              </View>
              {receipt.smallOrderFeeMinor > 0 ? (
                <View style={styles.feeRow}>
                  <AppText variant="body" color={colors.textDim}>
                    Small-order fee
                  </AppText>
                  <AppText variant="body" tabular>
                    {formatMoney(receipt.smallOrderFeeMinor, receipt.currency)}
                  </AppText>
                </View>
              ) : null}
              {receipt.tipMinor > 0 ? (
                <View style={styles.feeRow}>
                  <AppText variant="body" color={colors.textDim}>
                    Tip
                  </AppText>
                  <AppText variant="body" tabular>
                    {formatMoney(receipt.tipMinor, receipt.currency)}
                  </AppText>
                </View>
              ) : null}
              <View style={styles.divider} />
              <View style={styles.feeRow}>
                <AppText variant="bodyBold">Total</AppText>
                <AppText style={styles.totalValue} tabular>
                  {formatMoney(receipt.totalMinor, receipt.currency)}
                </AppText>
              </View>
            </Card>
          </Animated.View>

          <Animated.View entering={enterUp(2)} style={styles.whatNext}>
            <AppText variant="label" color={colors.textDim}>
              What happens next
            </AppText>
            {whatNextCopy(receipt).map((line, i) => (
              <View key={line} style={styles.whatNextRow}>
                <View style={styles.stepNumber} accessible={false} importantForAccessibility="no-hide-descendants">
                  <AppText style={styles.stepNumberText}>{i + 1}</AppText>
                </View>
                <AppText variant="body" style={{ flex: 1 }}>
                  {line}
                </AppText>
              </View>
            ))}
          </Animated.View>
        </>
      )}

      <View style={styles.buttonRow}>
        <Button label="Track this order" onPress={() => pushPath('/meals/orders')} />
        {receipt ? <Button label="Share receipt" variant="secondary" onPress={shareReceipt} /> : null}
        <Button label="Done" variant="ghost" onPress={() => replacePath('/meals')} />
      </View>
    </Screen>
  );
}
