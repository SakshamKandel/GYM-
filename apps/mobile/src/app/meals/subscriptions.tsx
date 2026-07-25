import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { formatMoney, isSlotOrderable, ktmAddDays, ktmDateString, ktmDayOfWeek } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
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
} from '../../components/ui';
import { EmptyArt } from '../../components/visual';
import { warnHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import { useMyMealSubscriptions } from '../../features/meals/hooks';
import { skipMealDay, toMealsError, updateMealSubscription, type MealSubscription } from '../../features/meals/api';
import { CyclePaymentPanel } from '../../features/meals/components/CyclePaymentPanel';
import { SubscriptionPlanCard } from '../../features/meals/components/SubscriptionPlanCard';
import { mealErrorMessage, weekdayLabel } from '../../features/meals/logic';
import { pushPath, replacePath } from '../../features/meals/nav';

/**
 * /meals/subscriptions — "my subscription" (plan §6/§7 P12): pause / resume /
 * skip-a-day / cancel for the caller's recurring meal plans. Visual language
 * matches the redesigned orders screen; every mutation stays a callback the
 * screen owns (SubscriptionPlanCard is presentation-only).
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
  header: { marginBottom: spacing.lg },
  list: { gap: spacing.md },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SKIP_WINDOW_DAYS = 14;

/** "Today" / "Tomorrow" / "Mon 28 Jul" for a skippable delivery date. */
function skipDayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === ktmAddDays(today, 1)) return 'Tomorrow';
  const month = MONTH_LABELS[Number(date.slice(5, 7)) - 1] ?? '';
  return `${weekdayLabel(ktmDayOfWeek(date))} ${Number(date.slice(8, 10))} ${month}`.trim();
}

/**
 * This plan's own delivery dates over the next two weeks that are still before
 * their cutoff — mirroring the exact rules the skip route enforces (a
 * subscribed weekday, today or later, on/after the plan's start, pre-cutoff),
 * so every chip the member can tap is one the server will accept. The skip
 * itself still round-trips; this only replaces typing a date by hand.
 */
function skippableDates(sub: MealSubscription, now: Date): { date: string; label: string }[] {
  const today = ktmDateString(now);
  const out: { date: string; label: string }[] = [];
  for (let i = 0; i < SKIP_WINDOW_DAYS; i += 1) {
    const date = ktmAddDays(today, i);
    if (date < sub.startDate) continue;
    if (!sub.daysOfWeek.includes(ktmDayOfWeek(date))) continue;
    if (!isSlotOrderable(date, sub.window, now)) continue;
    out.push({ date, label: skipDayLabel(date, today) });
  }
  return out;
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
  // Computed once per sheet opening, so the choices can't shift under a tap.
  const skipOptions = useMemo(() => (skipSub ? skippableDates(skipSub, new Date()) : []), [skipSub]);

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
        const apiErr = toMealsError(err);
        // Pack G: a funded future week can't self-serve cancel — the server
        // still returns an ESTIMATED proration so the member sees what they're
        // owed instead of just a dead-end block message.
        const refund = apiErr.details?.refund as
          | { estimatedMinor: number; currency: string | null; unusedDays: number }
          | undefined;
        const base = mealErrorMessage(apiErr.code);
        setActionError(
          refund && refund.estimatedMinor > 0 && refund.currency
            ? `${base} Estimated refund: ${formatMoney(refund.estimatedMinor, refund.currency)} for ${refund.unusedDays} unused day${refund.unusedDays === 1 ? '' : 's'}. Contact support to complete it.`
            : base,
        );
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

      <ScreenHeader eyebrow="Meals" title="My meal plans" style={styles.header} />

      {status !== 'signedIn' ? (
        <EmptyState
          icon="repeat-outline"
          title="Sign in to see your meal plans"
          actionLabel="Sign in"
          onAction={() => pushPath('/auth/sign-in')}
        />
      ) : (
        <>
          {error ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Your meal plans could not be loaded. Tap to retry."
                onPress={retry}
                style={styles.retryRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.retryText}>
                  Your meal plans could not be loaded. Tap to retry.
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {loading ? (
            <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading meal plans">
              {Array.from({ length: 2 }, (_, i) => (
                <SkeletonRow key={i} style={styles.skeletonRow} />
              ))}
            </Animated.View>
          ) : subs !== null && subs.length === 0 ? (
            <Animated.View entering={enterUp(0)}>
              <EmptyState
                icon="repeat-outline"
                title="No meal plans yet"
                body="Set up a weekly meal plan from a partner's menu."
                art={<EmptyArt variant="food" />}
                actionLabel="Browse partners"
                onAction={() => pushPath('/meals')}
              />
            </Animated.View>
          ) : subs !== null ? (
            <Animated.View entering={enterUp(0)} style={styles.list}>
              {subs.map((s) => (
                <SubscriptionPlanCard
                  key={s.id}
                  sub={s}
                  onAction={(sub, action) => setPending({ sub, action })}
                  onSkip={(sub) => {
                    setSkipSub(sub);
                    setSkipDate('');
                    setSkipError(null);
                  }}
                  onPay={(sub) => setPaySub(sub)}
                  onEdit={(sub) => pushPath(`/meals/subscription-edit?id=${encodeURIComponent(sub.id)}`)}
                />
              ))}
            </Animated.View>
          ) : null}
        </>
      )}

      <ConfirmDialog
        visible={pending !== null}
        title={`${actionVerb} meal plan`}
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
            Pick the delivery you want to skip.
          </AppText>
          {skipOptions.length > 0 ? (
            <View style={styles.chipRow}>
              {skipOptions.map((o) => (
                <Chip
                  key={o.date}
                  label={o.label}
                  selected={skipDate === o.date}
                  onPress={() => setSkipDate(o.date)}
                />
              ))}
            </View>
          ) : (
            <AppText variant="caption" color={colors.textDim}>
              Nothing to skip in the next two weeks. You can still type a date below.
            </AppText>
          )}
          <AppText variant="caption" color={colors.textFaint}>
            Or type another date (YYYY-MM-DD).
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
