import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney, ktmDateString } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Sheet,
  SkeletonRow,
  Tag,
} from '../../components/ui';
import { EmptyArt } from '../../components/visual';
import { warnHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import { useMyMealSubscriptions } from '../../features/meals/hooks';
import { skipMealDay, toMealsError, updateMealSubscription, type MealSubscription } from '../../features/meals/api';
import { CyclePaymentPanel } from '../../features/meals/components/CyclePaymentPanel';
import { mealErrorMessage, weekdayLabel, windowLabel } from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';

/**
 * /meals/subscriptions — "my subscription" (plan §6/§7 P12): pause / resume /
 * skip-a-day / cancel for the caller's recurring meal plans.
 */

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.md },
  list: { gap: spacing.md },
  card: { gap: spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  actionBtn: {
    minHeight: touch.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  actionBtnDanger: { borderWidth: 1.5, borderColor: colors.error, backgroundColor: 'transparent' },
  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  billText: { flex: 1, gap: 2 },
  errorText: { marginTop: spacing.sm },
  skeletons: { gap: spacing.md },
  skeletonRow: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, height: 96 },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginBottom: spacing.md,
  },
  retryText: { flex: 1 },
  skipForm: { gap: spacing.sm },
});

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

function SubscriptionCard({
  sub,
  onAction,
  onSkip,
  onPay,
}: {
  sub: MealSubscription;
  onAction: (sub: MealSubscription, action: 'pause' | 'resume' | 'cancel') => void;
  onSkip: (sub: MealSubscription) => void;
  onPay: (sub: MealSubscription) => void;
}) {
  const days = sub.daysOfWeek.map(weekdayLabel).join(', ');
  const bill = sub.pendingCycle;
  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <AppText variant="bodyBold">{windowLabel(sub.window)}</AppText>
        <Tag label={statusLabel(sub.status)} variant="outline" color={statusTone(sub.status)} />
      </View>
      <AppText variant="caption" color={colors.textDim}>
        {days} · {sub.planType === 'fixed_meal' ? 'Fixed meal' : "Chef's rotation"}
      </AppText>
      <AppText variant="body">
        {formatMoney(sub.pricePerDayMinor, sub.currency)}/day, billed weekly
      </AppText>

      {bill ? (
        <View style={styles.billRow}>
          <View style={styles.billText}>
            <AppText variant="bodyBold" color={colors.error}>
              {formatMoney(bill.amountMinor, bill.currency)} due
            </AppText>
            <AppText variant="caption" color={colors.textDim}>
              Week of {bill.weekStart} — deliveries are paused until this is paid.
            </AppText>
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Pay the ${formatMoney(bill.amountMinor, bill.currency)} bill for this plan`}
            onPress={() => onPay(sub)}
            style={styles.actionBtn}
          >
            <AppText variant="bodyBold" color={colors.error}>
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

export default function MyMealSubscriptionsScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const { data: subs, loading, error, retry, reload } = useMyMealSubscriptions(
    status === 'signedIn' ? token : null,
  );

  const [pending, setPending] = useState<{ sub: MealSubscription; action: 'pause' | 'resume' | 'cancel' } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [skipSub, setSkipSub] = useState<MealSubscription | null>(null);
  const [skipDate, setSkipDate] = useState('');
  const [skipError, setSkipError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  const [paySub, setPaySub] = useState<MealSubscription | null>(null);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath('/meals');
  }

  function confirmAction(): void {
    if (!pending || !token || busy) return;
    setBusy(true);
    setActionError(null);
    void (async () => {
      try {
        await updateMealSubscription(token, pending.sub.id, pending.action);
        setPending(null);
        reload();
      } catch (err) {
        setActionError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setBusy(false);
      }
    })();
  }

  function submitSkip(): void {
    if (!skipSub || !token || skipping || !/^\d{4}-\d{2}-\d{2}$/.test(skipDate.trim())) return;
    setSkipping(true);
    setSkipError(null);
    void (async () => {
      try {
        await skipMealDay(token, skipSub.id, skipDate.trim());
        setSkipSub(null);
        setSkipDate('');
        reload();
      } catch (err) {
        setSkipError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setSkipping(false);
      }
    })();
  }

  const actionVerb = pending?.action === 'pause' ? 'Pause' : pending?.action === 'resume' ? 'Resume' : 'Cancel';

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Meals" title="My subscriptions" style={styles.header} />

      {status !== 'signedIn' ? (
        <EmptyState
          icon="repeat-outline"
          title="Sign in to see your plans"
          actionLabel="Sign in"
          onAction={() => pushPath('/auth/sign-in')}
        />
      ) : (
        <>
          {error ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Couldn't load your plans. Tap to retry."
                onPress={retry}
                style={styles.retryRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.retryText}>
                  Couldn&apos;t load your plans — tap to retry.
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {loading ? (
            <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading plans">
              {Array.from({ length: 2 }, (_, i) => (
                <SkeletonRow key={i} style={styles.skeletonRow} />
              ))}
            </Animated.View>
          ) : subs !== null && subs.length === 0 ? (
            <Animated.View entering={enterUp(0)}>
              <EmptyState
                icon="repeat-outline"
                title="No plans yet"
                body="Set up a weekly plan from a partner's menu."
                art={<EmptyArt variant="food" />}
                actionLabel="Browse partners"
                onAction={() => pushPath('/meals')}
              />
            </Animated.View>
          ) : subs !== null ? (
            <Animated.View entering={enterUp(0)} style={styles.list}>
              {subs.map((s) => (
                <SubscriptionCard
                  key={s.id}
                  sub={s}
                  onAction={(sub, action) => setPending({ sub, action })}
                  onSkip={(sub) => {
                    setSkipSub(sub);
                    setSkipDate('');
                    setSkipError(null);
                  }}
                  onPay={(sub) => setPaySub(sub)}
                />
              ))}
            </Animated.View>
          ) : null}
        </>
      )}

      <ConfirmDialog
        visible={pending !== null}
        title={`${actionVerb} plan`}
        message={actionError ?? `${actionVerb} this weekly meal plan?`}
        confirmLabel={actionVerb}
        cancelLabel="Back"
        danger={pending?.action === 'cancel'}
        onConfirm={confirmAction}
        onCancel={() => {
          setPending(null);
          setActionError(null);
        }}
      />

      <Sheet visible={skipSub !== null} onClose={() => setSkipSub(null)} title="Skip a delivery day">
        <View style={styles.skipForm}>
          <AppText variant="body" color={colors.textDim}>
            Enter the date to skip (YYYY-MM-DD). It must be one of this plan&apos;s delivery days and still before
            that slot&apos;s cutoff.
          </AppText>
          <AppTextInput
            value={skipDate}
            onChangeText={setSkipDate}
            placeholder={ktmDateString(new Date())}
            accessibilityLabel="Date to skip"
          />
          {skipError ? (
            <AppText variant="caption" color={colors.error} style={styles.errorText}>
              {skipError}
            </AppText>
          ) : null}
          <Button
            label="Skip this day"
            onPress={submitSkip}
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(skipDate.trim())}
            loading={skipping}
          />
        </View>
      </Sheet>

      <Sheet visible={paySub !== null} onClose={() => setPaySub(null)} title="Pay weekly bill">
        {token && paySub?.pendingCycle ? (
          <CyclePaymentPanel
            token={token}
            cycle={paySub.pendingCycle}
            method={paySub.paymentMethod === 'khalti' ? 'khalti' : 'esewa'}
            onDone={() => {
              setPaySub(null);
              reload();
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}
