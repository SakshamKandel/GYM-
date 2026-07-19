import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney, ktmAddDays, ktmDateString, ktmDayOfWeek } from '@gym/shared';
import { AppText, Card, PressableScale, Tag } from '../../../components/ui';
import type { MealSubscription } from '../api';

/**
 * Polished recurring-plan card for /meals/subscriptions — day-of-week pills, a
 * next-delivery highlight, and a weekly-bill payment block. Presentation only:
 * every state change (pause / resume / skip / cancel / pay) is a callback the
 * screen owns, unchanged from the original SubscriptionCard.
 */

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function statusTone(status: MealSubscription['status']): string {
  if (status === 'active') return colors.success;
  if (status === 'paused') return colors.textDim;
  return colors.error;
}

function statusLabel(status: MealSubscription['status']): string {
  if (status === 'active') return 'Active';
  if (status === 'paused') return 'Paused';
  return 'Cancelled';
}

/** Soonest upcoming date (KTM) matching a delivery weekday — a display-only
 * highlight; the server remains the authority on actual materialization. */
function nextDeliveryLabel(daysOfWeek: number[], now: Date = new Date()): string | null {
  if (daysOfWeek.length === 0) return null;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = ktmDateString(now);
  let date = today;
  for (let i = 0; i < 7; i += 1) {
    if (daysOfWeek.includes(ktmDayOfWeek(date))) {
      if (date === today) return 'today';
      if (date === ktmAddDays(today, 1)) return 'tomorrow';
      return `on ${WEEKDAYS[ktmDayOfWeek(date)]}`;
    }
    date = ktmAddDays(date, 1);
  }
  return null;
}

interface Props {
  sub: MealSubscription;
  onAction: (sub: MealSubscription, action: 'pause' | 'resume' | 'cancel') => void;
  onSkip: (sub: MealSubscription) => void;
  onPay: (sub: MealSubscription) => void;
}

export function SubscriptionPlanCard({ sub, onAction, onSkip, onPay }: Props) {
  const bill = sub.pendingCycle;
  const nextDay = sub.status === 'active' && !bill ? nextDeliveryLabel(sub.daysOfWeek) : null;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconChip}>
          <Ionicons name="repeat" size={22} color={colors.accent} />
        </View>
        <View style={styles.headerText}>
          <AppText variant="label" color={colors.textDim}>
            {sub.planType === 'fixed_meal' ? 'Fixed meal' : "Chef's rotation"}
          </AppText>
          <AppText variant="bodyBold">{sub.window === 'lunch' ? 'Lunch plan' : 'Dinner plan'}</AppText>
        </View>
        <Tag label={statusLabel(sub.status)} variant="outline" color={statusTone(sub.status)} />
      </View>

      <View
        style={styles.daysRow}
        accessibilityLabel={`Delivery days: ${sub.daysOfWeek
          .slice()
          .sort((a, b) => a - b)
          .map((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d])
          .join(', ')}`}
      >
        {DAY_LETTERS.map((letter, i) => {
          const on = sub.daysOfWeek.includes(i);
          return (
            <View key={i} style={[styles.dayPill, on ? styles.dayPillOn : styles.dayPillOff]}>
              <AppText
                variant="caption"
                color={on ? colors.onBlock : colors.textFaint}
                tabular={false}
                style={styles.dayLetter}
              >
                {letter}
              </AppText>
            </View>
          );
        })}
      </View>

      <View style={styles.metaRow}>
        <AppText variant="body" color={colors.textDim}>
          {formatMoney(sub.pricePerDayMinor, sub.currency)}/day · billed weekly
        </AppText>
      </View>

      {nextDay ? (
        <View style={styles.nextChip}>
          <Ionicons name="calendar-outline" size={14} color={colors.accent} />
          <AppText variant="caption" color={colors.text}>
            Next delivery {nextDay}
          </AppText>
        </View>
      ) : null}

      {bill ? (
        <View style={styles.billRow}>
          <View style={styles.billText}>
            <View style={styles.billTopLine}>
              <AppText variant="bodyBold" color={colors.error}>
                {formatMoney(bill.amountMinor, bill.currency)} due
              </AppText>
              <Tag label="Payment due" variant="outline" color={colors.error} />
            </View>
            <AppText variant="caption" color={colors.textDim}>
              Week of {bill.weekStart} — deliveries pause until this is paid.
            </AppText>
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Pay the ${formatMoney(bill.amountMinor, bill.currency)} bill for this plan`}
            onPress={() => onPay(sub)}
            style={[styles.actionBtn, styles.payBtn]}
          >
            <AppText variant="bodyBold" color={colors.onBlock}>
              Pay bill
            </AppText>
          </PressableScale>
        </View>
      ) : null}

      {sub.status !== 'cancelled' ? (
        <View style={styles.actionsRow}>
          {sub.status === 'active' ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Pause this plan"
              onPress={() => onAction(sub, 'pause')}
              style={styles.actionBtn}
            >
              <AppText variant="bodyBold">Pause</AppText>
            </PressableScale>
          ) : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Resume this plan"
              onPress={() => onAction(sub, 'resume')}
              style={styles.actionBtn}
            >
              <AppText variant="bodyBold">Resume</AppText>
            </PressableScale>
          )}
          {sub.status === 'active' ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Skip a delivery day"
              onPress={() => onSkip(sub)}
              style={styles.actionBtn}
            >
              <AppText variant="bodyBold">Skip a day</AppText>
            </PressableScale>
          ) : null}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Cancel this plan"
            onPress={() => onAction(sub, 'cancel')}
            style={[styles.actionBtn, styles.actionBtnDanger]}
          >
            <AppText variant="bodyBold" color={colors.error}>
              Cancel
            </AppText>
          </PressableScale>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  daysRow: { flexDirection: 'row', gap: spacing.xs },
  dayPill: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillOn: { backgroundColor: colors.accent },
  dayPillOff: { backgroundColor: colors.surfaceRaised },
  dayLetter: { fontSize: 13 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.accentFaint,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  billText: { flex: 1, gap: 4 },
  billTopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
  actionBtn: {
    minHeight: touch.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  payBtn: { backgroundColor: colors.accent },
  actionBtnDanger: { borderWidth: 1.5, borderColor: colors.error, backgroundColor: 'transparent' },
});
