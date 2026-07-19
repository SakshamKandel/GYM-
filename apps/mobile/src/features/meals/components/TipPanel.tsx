import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Button, PressableScale } from '../../../components/ui';
import { setMealOrderTip, toMealsError, type MealOrder } from '../api';
import { mealErrorMessage, tipOptions, tipPresetLabel } from '../logic';
import { successHaptic, warnHaptic } from '../../../lib/haptics';

/**
 * Gratuity editor (Pack D) — preset percentages of the subtotal (server has
 * the exact same {@link tipOptions} math) plus a custom-amount step, only
 * while the order is still `unpaid` (the tip route 409s `tip_locked`
 * otherwise, surfaced via the normal error line — this panel simply isn't
 * rendered for a paid/cancelled/refused order per the caller's gating).
 */

const CUSTOM_STEP_MINOR_DIVISOR = 20; // ± 5% of subtotal per tap, floor 1 unit.

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  presetRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  presetBtn: {
    minHeight: touch.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  presetBtnOn: { backgroundColor: colors.accent },
  customRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

interface Props {
  token: string;
  order: MealOrder;
  onDone: (order: MealOrder) => void;
}

export function TipPanel({ token, order, onDone }: Props) {
  const options = tipOptions(order.subtotalMinor);
  const [tipMinor, setTipMinor] = useState(order.tipMinor);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = Math.max(1, Math.round(order.subtotalMinor / CUSTOM_STEP_MINOR_DIVISOR));

  function submit(): void {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        const updated = await setMealOrderTip(token, order.id, tipMinor);
        successHaptic();
        onDone(updated);
      } catch (err) {
        setError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setSubmitting(false);
      }
    })();
  }

  return (
    <View style={styles.wrap}>
      <AppText variant="body" color={colors.textDim}>
        Add a tip for your rider / kitchen — 100% goes to the partner.
      </AppText>
      <View style={styles.presetRow}>
        {options.map((opt) => {
          const on = tipMinor === opt.amountMinor;
          return (
            <PressableScale
              key={opt.percent}
              accessibilityRole="button"
              accessibilityLabel={`${tipPresetLabel(opt.percent)} tip — ${formatMoney(opt.amountMinor, order.currency)}`}
              onPress={() => setTipMinor(opt.amountMinor)}
              style={[styles.presetBtn, on && styles.presetBtnOn]}
            >
              <AppText variant="bodyBold" color={on ? colors.onBlock : colors.text}>
                {tipPresetLabel(opt.percent)}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
      <View style={styles.customRow}>
        <AppText variant="body" color={colors.textDim}>
          Custom amount
        </AppText>
        <View style={styles.stepGroup}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Decrease tip"
            onPress={() => setTipMinor((v) => Math.max(0, v - step))}
            style={styles.stepBtn}
          >
            <AppText variant="bodyBold">−</AppText>
          </PressableScale>
          <AppText variant="bodyBold" tabular style={{ minWidth: 80, textAlign: 'center' }}>
            {formatMoney(tipMinor, order.currency)}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Increase tip"
            onPress={() => setTipMinor((v) => v + step)}
            style={styles.stepBtn}
          >
            <AppText variant="bodyBold">+</AppText>
          </PressableScale>
        </View>
      </View>
      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}
      <Button
        label={order.tipMinor > 0 ? 'Update tip' : 'Add tip'}
        onPress={submit}
        loading={submitting}
        disabled={tipMinor === order.tipMinor}
      />
    </View>
  );
}
