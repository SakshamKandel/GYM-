import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import {
  getCoachWallet,
  getMyPayoutStatus,
  payoutMinimumFor,
  requestPayout,
  toStaffError,
  type CoachWallet,
  type MyPayoutRequest,
  type PayoutStatus,
  type WalletEntry,
} from '../../../features/staff/api';
import { replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Wallet — the full commission ledger behind the inbox's wallet card.
 *
 * Top: a red hero with the per-currency balances. Below: the caller's own
 * promo code (selectable — long-press to copy, no expo-clipboard dependency;
 * see the inbox card's doc comment) and its redemption count. Then the 50
 * newest ledger entries (commission / adjustment / payout), newest first,
 * each showing the signed amount, a type tag, an optional note and a relative
 * timestamp. Read-only — payouts are recorded by admins, never initiated here
 * (SCALE-UP-PLAN §9: no real payout rails yet).
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader → ONE red hero block
 * (balances, black ink) → charcoal code card → charcoal ledger rows, no
 * borders.
 */

const TYPE_LABEL: Record<WalletEntry['type'], string> = {
  commission: 'Commission',
  adjustment: 'Adjustment',
  payout: 'Payout',
};

const TYPE_COLOR: Record<WalletEntry['type'], string> = {
  commission: colors.success,
  adjustment: colors.blue,
  payout: colors.warning,
};

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

/** "+NPR 300" / "-NPR 90" — a signed money line for one ledger entry. */
function signedAmount(entry: WalletEntry): string {
  const sign = entry.amountMinor < 0 ? '-' : '+';
  return `${sign}${formatMoney(Math.abs(entry.amountMinor), entry.currency)}`;
}

function errorLine(code: string): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load your wallet.";
}

function payoutErrorLine(code: string, currency: string): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  if (code === 'already_pending')
    return 'You already have a pending payout request — wait for it to be decided first.';
  if (code === 'insufficient_balance') return "That's more than your current balance.";
  // 'invalid' also covers the server's below-minimum rejection.
  if (code === 'invalid')
    return `Amount must be at least ${formatMoney(payoutMinimumFor(currency), currency)}.`;
  return "Couldn't submit the request.";
}

function payoutStatusTone(status: PayoutStatus): { label: string; color: string } {
  if (status === 'approved') return { label: 'Approved', color: colors.success };
  if (status === 'paid') return { label: 'Paid', color: colors.success };
  if (status === 'rejected') return { label: 'Rejected', color: colors.error };
  return { label: 'Pending', color: colors.warning };
}

export default function CoachWalletScreen() {
  const token = useAuth((s) => s.token);
  const [wallet, setWallet] = useState<CoachWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [payouts, setPayouts] = useState<MyPayoutRequest[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('NPR');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('You are signed out.');
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setWallet(await getCoachWallet(token));
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadPayouts = useCallback(async () => {
    if (!token) {
      setPayoutsLoading(false);
      return;
    }
    setPayoutsError(null);
    setPayoutsLoading(true);
    try {
      setPayouts(await getMyPayoutStatus(token));
    } catch (err) {
      setPayoutsError(payoutErrorLine(toStaffError(err).code, currency));
    } finally {
      setPayoutsLoading(false);
    }
  }, [token, currency]);

  useEffect(() => {
    void load();
    void loadPayouts();
  }, [load, loadPayouts]);

  // One-pending-per-coach: the server enforces it, this just derives the UI
  // state from the same history list (getMyPayoutStatus) rather than
  // tracking it separately.
  const pendingPayout = payouts.find((p) => p.status === 'pending') ?? null;
  const balanceCurrencies = (wallet?.balances ?? []).map((b) => b.currency);
  const currencyOptions = balanceCurrencies.length > 0 ? balanceCurrencies : ['NPR', 'USD'];

  async function submitPayoutRequest(): Promise<void> {
    if (!token || submitting || pendingPayout) return;
    const major = Number(amount.trim());
    if (!amount.trim() || !Number.isFinite(major) || major <= 0) {
      setSubmitError('Enter a positive amount.');
      return;
    }
    const amountMinor = Math.round(major * 100);
    const minimum = payoutMinimumFor(currency);
    if (amountMinor < minimum) {
      setSubmitError(`Amount must be at least ${formatMoney(minimum, currency)}.`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await requestPayout(amountMinor, currency, token);
      setAmount('');
      await loadPayouts();
    } catch (err) {
      setSubmitError(payoutErrorLine(toStaffError(err).code, currency));
    } finally {
      setSubmitting(false);
    }
  }

  function goBack(): void {
    replaceStaff(STAFF_ROUTES.coachInbox);
  }

  const redemptions = wallet?.code?.redemptionCount ?? 0;

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to inbox"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Coach console" title="Wallet" style={styles.header} />

      {loading && !wallet ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && !wallet ? (
        <View style={styles.centerState}>
          <AppText variant="caption" center color={colors.textFaint}>
            {error}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={() => void load()}
            style={styles.retryBtn}
          >
            <AppText variant="bodyBold" color={colors.accent}>
              Try again
            </AppText>
          </PressableScale>
        </View>
      ) : wallet ? (
        <>
          {/* The ONE red hero block: per-currency balances, black ink. */}
          <Animated.View entering={enterUp(0)} style={styles.hero}>
            <AppText variant="label" color={colors.onBlock}>
              Balance
            </AppText>
            {wallet.balances.length > 0 ? (
              <View style={styles.balanceRow}>
                {wallet.balances.map((b) => (
                  <AppText key={b.currency} variant="display" color={colors.onBlock} tabular>
                    {formatMoney(b.amountMinor, b.currency)}
                  </AppText>
                ))}
              </View>
            ) : (
              <AppText variant="body" color={colors.onBlock} style={styles.heroDim}>
                No commission yet
              </AppText>
            )}
          </Animated.View>

          {wallet.code ? (
            <Animated.View entering={enterUp(1)} style={styles.codeCard}>
              <AppText variant="label" color={colors.textFaint}>
                Your promo code
              </AppText>
              <Text selectable style={styles.codeText}>
                {wallet.code.code}
              </Text>
              <View style={styles.codeMetaRow}>
                <Tag label={`${wallet.code.discountPct}% off them`} variant="dim" />
                <Tag label={`${wallet.code.commissionPct}% to you`} variant="dim" />
                <Tag label={`${redemptions} redemption${redemptions === 1 ? '' : 's'}`} variant="dim" />
              </View>
              <AppText variant="caption" color={colors.textFaint} style={styles.codeHint}>
                Long-press the code to copy it.
              </AppText>
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(2)} style={styles.payoutCard}>
            <SectionLabel>Request a payout</SectionLabel>

            {pendingPayout ? (
              <View style={styles.pendingBanner}>
                <Ionicons name="time-outline" size={16} color={colors.warning} />
                <AppText variant="caption" color={colors.textDim} style={styles.pendingBannerText}>
                  You have a pending request for{' '}
                  {formatMoney(pendingPayout.amountMinor, pendingPayout.currency)} — wait for an
                  admin to decide it before requesting again.
                </AppText>
              </View>
            ) : (
              <>
                <View style={styles.chipsRow}>
                  {currencyOptions.map((c) => (
                    <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
                  ))}
                </View>
                <AppTextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder={`Amount (min ${formatMoney(payoutMinimumFor(currency), currency)})`}
                  keyboardType="decimal-pad"
                  editable={!submitting}
                  accessibilityLabel="Payout amount"
                />
                {submitError ? (
                  <AppText variant="caption" color={colors.error}>
                    {submitError}
                  </AppText>
                ) : null}
                <Button
                  label={submitting ? 'Submitting…' : 'Request payout'}
                  onPress={() => void submitPayoutRequest()}
                  loading={submitting}
                  disabled={submitting}
                  style={styles.requestBtn}
                />
              </>
            )}

            {payoutsLoading && payouts.length === 0 ? (
              <ActivityIndicator color={colors.textDim} style={styles.payoutSpinner} />
            ) : payoutsError && payouts.length === 0 ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Retry loading your payout history"
                onPress={() => void loadPayouts()}
                style={styles.staleRow}
              >
                <Ionicons name="cloud-offline-outline" size={14} color={colors.textDim} />
                <AppText variant="caption">{payoutsError} Tap to retry.</AppText>
              </PressableScale>
            ) : payouts.length > 0 ? (
              <View style={styles.payoutHistory}>
                <AppText variant="label" color={colors.textFaint}>
                  History
                </AppText>
                {payouts.map((p) => {
                  const tone = payoutStatusTone(p.status);
                  return (
                    <View key={p.id} style={styles.row}>
                      <View style={styles.rowText}>
                        <View style={styles.rowHead}>
                          <Tag label={tone.label} variant="outline" color={tone.color} />
                          <AppText variant="caption" color={colors.textFaint}>
                            {relativeTime(p.requestedAt)}
                          </AppText>
                        </View>
                        {p.disbursementRef ? (
                          <AppText variant="caption" numberOfLines={1}>
                            Ref: {p.disbursementRef}
                          </AppText>
                        ) : null}
                      </View>
                      <AppText variant="bodyBold" tabular>
                        {formatMoney(p.amountMinor, p.currency)}
                      </AppText>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </Animated.View>

          <SectionLabel>Recent activity</SectionLabel>
          {error ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Retry loading your wallet"
              onPress={() => void load()}
              style={styles.staleRow}
            >
              <Ionicons name="cloud-offline-outline" size={14} color={colors.textDim} />
              <AppText variant="caption">Couldn&apos;t refresh · tap to retry</AppText>
            </PressableScale>
          ) : null}

          {wallet.entries.length === 0 ? (
            <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
              No ledger entries yet — commission lands here when someone redeems your
              code.
            </AppText>
          ) : (
            <View style={styles.list}>
              {wallet.entries.map((e, i) => (
                <Animated.View key={e.id} entering={enterUp(Math.min(i, 6))} style={styles.row}>
                  <View style={styles.rowText}>
                    <View style={styles.rowHead}>
                      <Tag label={TYPE_LABEL[e.type]} variant="outline" color={TYPE_COLOR[e.type]} />
                      <AppText variant="caption" color={colors.textFaint}>
                        {relativeTime(e.createdAt)}
                      </AppText>
                    </View>
                    {e.note ? (
                      <AppText variant="caption" numberOfLines={2}>
                        {e.note}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText
                    variant="bodyBold"
                    tabular
                    color={e.amountMinor < 0 ? colors.warning : colors.success}
                  >
                    {signedAmount(e)}
                  </AppText>
                </Animated.View>
              ))}
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  payoutCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pendingBannerText: { flex: 1 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  requestBtn: { marginTop: spacing.xs },
  payoutSpinner: { marginVertical: spacing.sm, alignSelf: 'flex-start' },
  payoutHistory: { gap: spacing.sm, marginTop: spacing.sm },
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  centerState: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  retryBtn: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  // The one red hero block (brief §2): flat fill, chunky corners, black ink.
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  heroDim: { opacity: 0.8 },
  balanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  // Charcoal code card (brief §11c): fill contrast, no hairline borders.
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  codeText: {
    fontFamily: type.display,
    fontSize: 30,
    letterSpacing: 2,
    color: colors.accent,
  },
  codeMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  codeHint: { marginTop: spacing.xs },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  emptyLine: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  list: { gap: spacing.sm },
  // Charcoal ledger row (brief §11c): fill contrast, no hairline borders.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowText: { flex: 1, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
