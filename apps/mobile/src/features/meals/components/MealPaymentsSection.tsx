import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Card, Tag } from '../../../components/ui';
import {
  fetchMealPaymentRequests,
  type MealPaymentRequestRow,
  type MealPaymentRequestStatus,
} from '../api';
import { paymentMethodLabel } from '../logic';

/**
 * The member's own eSewa/Khalti receipt submissions (GET /api/meals/payments).
 *
 * Why this exists: before it, a receipt an admin rejected left NO in-app trace.
 * The member got a single push ("not approved this time: <reason>") and, if it
 * was missed or notifications were off, they were left staring at an unpaid
 * order with no idea what happened or what to do next. This section is the
 * durable record — every receipt, its plain-language state, and the reviewer's
 * reason when there is one.
 *
 * Self-fetching so any meals screen can drop it in with just a token. It
 * renders NOTHING when the member has never submitted a receipt (the common
 * case, and especially for cash-on-delivery members) so it never adds empty
 * chrome to a screen.
 */

interface Props {
  token: string;
  /** Bump to re-fetch — e.g. right after a receipt upload succeeds. */
  refreshKey?: number;
}

/** Plain-language state, no payment jargon. */
function stateLabel(status: MealPaymentRequestStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting for review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Not accepted';
    case 'refunded':
      return 'Refunded';
  }
}

function stateTone(status: MealPaymentRequestStatus): string {
  switch (status) {
    case 'pending':
      return colors.warning;
    case 'approved':
      return colors.success;
    case 'rejected':
      return colors.error;
    // Money came back — not the member's mistake, so stay neutral, not alarm-red.
    case 'refunded':
      return colors.textDim;
  }
}

/**
 * The explanation line. A reviewer's note always wins; otherwise each state
 * gets copy that says what happened AND what to do next, so no row is ever a
 * dead end.
 */
function explanation(request: MealPaymentRequestRow): string | null {
  if (request.reviewNote) return request.reviewNote;
  switch (request.status) {
    case 'pending':
      return 'We usually check receipts within 24 hours.';
    case 'rejected':
      return "We couldn't confirm this receipt. Upload a clearer photo and send it again.";
    case 'refunded':
      return 'This payment was returned to you.';
    case 'approved':
      return null;
  }
}

/** What the receipt was paying for, in the member's words. */
function targetLabel(request: MealPaymentRequestRow): string {
  if (request.orderId) return 'Meal order';
  if (request.cycleId) return 'Weekly meal plan';
  return 'Meal payment';
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function PaymentRow({ request }: { request: MealPaymentRequestRow }) {
  const label = stateLabel(request.status);
  const reason = explanation(request);
  const date = formatDate(request.createdAt);
  const amount = formatMoney(request.amountMinor, request.currency);

  return (
    <Card padding={spacing.md}>
      {/*
        The label lives on this grouping View, not on Card: Card only forwards
        accessibilityLabel when it is pressable (it renders a bare View
        otherwise), so putting it there would silently drop it. One spoken
        sentence — a screen reader shouldn't have to stitch four separate
        scraps together to learn a receipt was turned down.
      */}
      <View
        accessible
        accessibilityLabel={`${targetLabel(request)}, ${amount} via ${paymentMethodLabel(
          request.method,
        )}${date ? `, ${date}` : ''}. ${label}.${reason ? ` ${reason}` : ''}`}
        style={styles.row}
      >
        <View style={styles.topLine}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.target}>
            {targetLabel(request)}
          </AppText>
          <Tag label={label} variant="outline" color={stateTone(request.status)} />
        </View>
        <AppText variant="caption" color={colors.textDim}>
          {amount} via {paymentMethodLabel(request.method)}
          {date ? ` · ${date}` : ''}
        </AppText>
        {reason ? (
          <AppText variant="caption" color={colors.textDim}>
            {reason}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

export function MealPaymentsSection({ token, refreshKey }: Props) {
  const [requests, setRequests] = useState<MealPaymentRequestRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchMealPaymentRequests(token);
        if (!cancelled) setRequests(rows);
      } catch {
        // Silent, and the last-known list stays on screen: a payment history
        // is reference material, never a blocking flow, so a flaky network
        // must not throw an error banner at someone just browsing meals.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  if (requests.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <AppText variant="label">Payments</AppText>
      {requests.map((request) => (
        <PaymentRow key={request.id} request={request} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // The section spaces itself, so a screen can drop it in without leaving a
  // gap behind on the (common) days it renders nothing.
  wrap: { gap: spacing.sm, marginTop: spacing.xl },
  row: { gap: 3 },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  target: { flex: 1 },
});
