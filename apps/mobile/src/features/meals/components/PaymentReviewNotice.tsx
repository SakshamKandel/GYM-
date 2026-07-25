import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';
import type { MealPaymentRequestRow } from '../api';

/**
 * What happened to the receipt a member sent for THIS order, shown on the
 * order itself.
 *
 * Before this, a turned-down receipt left no trace anywhere the member looks:
 * the order silently went back to "Payment needed", the reviewer's reason
 * lived only in a push that may have been missed or switched off, and the
 * member was left staring at an unpaid order with no idea why. The reason is
 * the whole point of the component, so it always leads.
 *
 * Renders nothing when there is no receipt for the order, or when the receipt
 * was approved and the order already reads as paid — a green "approved" line
 * next to a paid total is noise.
 */

interface Props {
  /** The newest receipt submitted for this order, or null when there is none. */
  request: MealPaymentRequestRow | null;
  /** Offered on a turned-down receipt: opens the receipt sheet again. */
  onSendAgain?: () => void;
}

function toneFor(status: MealPaymentRequestRow['status']): string {
  switch (status) {
    case 'pending':
      return colors.warning;
    case 'rejected':
      return colors.error;
    case 'refunded':
      return colors.textDim;
    case 'approved':
      return colors.success;
  }
}

function iconFor(status: MealPaymentRequestRow['status']): 'time-outline' | 'alert-circle' | 'arrow-undo' | 'checkmark-circle' {
  switch (status) {
    case 'pending':
      return 'time-outline';
    case 'rejected':
      return 'alert-circle';
    case 'refunded':
      return 'arrow-undo';
    case 'approved':
      return 'checkmark-circle';
  }
}

function headlineFor(status: MealPaymentRequestRow['status']): string {
  switch (status) {
    case 'pending':
      return 'Receipt under review';
    case 'rejected':
      return 'Your receipt was not accepted';
    case 'refunded':
      return 'This payment was returned';
    case 'approved':
      return 'Receipt accepted';
  }
}

/** The reviewer's reason wins; otherwise say what happens next anyway. */
function detailFor(request: MealPaymentRequestRow): string | null {
  if (request.reviewNote) return request.reviewNote;
  switch (request.status) {
    case 'pending':
      return 'We usually check receipts within a day.';
    case 'rejected':
      return "We couldn't match this receipt to a payment. Send a clearer photo of the full receipt and we'll look again.";
    case 'refunded':
      return 'The money has gone back to you.';
    case 'approved':
      return null;
  }
}

export function PaymentReviewNotice({ request, onSendAgain }: Props) {
  if (request === null) return null;
  if (request.status === 'approved') return null;

  const tone = toneFor(request.status);
  const headline = headlineFor(request.status);
  const detail = detailFor(request);
  const amount = formatMoney(request.amountMinor, request.currency);
  const canRetry = request.status === 'rejected' && onSendAgain !== undefined;

  return (
    <View
      accessible={!canRetry}
      accessibilityLabel={canRetry ? undefined : `${headline}. ${amount}.${detail ? ` ${detail}` : ''}`}
      style={styles.wrap}
    >
      <View style={styles.headRow}>
        <Ionicons name={iconFor(request.status)} size={18} color={tone} />
        <AppText variant="bodyBold" color={tone} style={styles.headline}>
          {headline}
        </AppText>
      </View>
      <AppText variant="caption" color={colors.textDim}>
        {amount}
      </AppText>
      {detail ? (
        <AppText variant="caption" color={colors.textDim}>
          {detail}
        </AppText>
      ) : null}
      {canRetry ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Send another receipt for this order"
          onPress={onSendAgain}
          style={styles.retryBtn}
        >
          <AppText variant="bodyBold">Send another receipt</AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 3,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headline: { flex: 1, minWidth: 0 },
  retryBtn: {
    marginTop: spacing.sm,
    minHeight: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
