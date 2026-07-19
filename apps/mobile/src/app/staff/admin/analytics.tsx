import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  EmptyState,
  enterDown,
  enterUp,
  PressableScale,
  ProgressBar,
  Screen,
  ScreenHeader,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import {
  getAdminAnalytics,
  toStaffError,
  type AdminAnalytics,
  type CoachPerformance,
  type CurrencyAmount,
  type PromoPerformance,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Analytics — the platform analytics snapshot (v1.0.3 mobile parity,
 * ARCHITECTURE-REVIEW-2026-07-18 §6 NEXT). One GET (getAdminAnalytics)
 * returns everything; this screen is a read-only render of it — no chart
 * libs, just stat tiles and token-styled horizontal bars (ProgressBar scaled
 * to the max value in each series), matching the web console's ChartCard
 * intent without pulling in an SVG dependency mobile doesn't have.
 *
 * Every figure here is a server-side aggregate — no member PII crosses this
 * screen. Requires `analytics.read` (super/main, or a per-account override).
 */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2026-07" → "Jul 2026". Falls back to the raw string if unparseable. */
function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return month;
  return `${MONTH_NAMES[idx]} ${y}`;
}

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  return "Couldn't load analytics.";
}

/** Join a list of currency amounts into one compact line ("NPR 1,200 · USD 40"). */
function moneyList(amounts: CurrencyAmount[]): string {
  if (amounts.length === 0) return '—';
  return amounts.map((a) => formatMoney(a.amountMinor, a.currency)).join(' · ');
}

/** ±% change of current vs prior, formatted with a sign. Null when prior is 0. */
function pctDelta(current: number, prior: number): string | null {
  if (prior === 0) return null;
  const pct = ((current - prior) / prior) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onRetry}
      style={styles.retry}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption">{message} Tap to retry.</AppText>
    </PressableScale>
  );
}

/** One horizontal bar row: label, a ProgressBar scaled against `max`, and a value string. */
function BarRow({
  label,
  value,
  valueLabel,
  max,
}: {
  label: string;
  value: number;
  valueLabel: string;
  max: number;
}) {
  return (
    <View style={styles.barRow}>
      <View style={styles.barHead}>
        <AppText variant="caption" numberOfLines={1} style={styles.barLabel}>
          {label}
        </AppText>
        <AppText variant="caption" color={colors.textDim} tabular>
          {valueLabel}
        </AppText>
      </View>
      <ProgressBar
        value={max > 0 ? value / max : 0}
        height={8}
        accessibilityLabel={`${label}: ${valueLabel}`}
      />
    </View>
  );
}

function DeltaTile({
  label,
  current,
  prior,
  unit,
}: {
  label: string;
  current: number;
  prior: number;
  unit?: string;
}) {
  const delta = pctDelta(current, prior);
  const positive = current >= prior;
  return (
    <View style={styles.deltaTile}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="stat" tabular>
        {current.toLocaleString()}
        {unit ? <AppText variant="caption" color={colors.textDim}> {unit}</AppText> : null}
      </AppText>
      <AppText variant="caption" color={delta === null ? colors.textFaint : positive ? colors.success : colors.error}>
        {delta === null ? `Prior period: ${prior.toLocaleString()}` : `${delta} vs prior (${prior.toLocaleString()})`}
      </AppText>
    </View>
  );
}

function RevenueByMonthCard({ analytics }: { analytics: AdminAnalytics }) {
  const recentMonths = useMemo(() => analytics.revenueByMonth.slice(-6), [analytics.revenueByMonth]);

  if (recentMonths.length === 0 || analytics.currencies.length === 0) {
    return (
      <Card style={styles.sectionCard}>
        <SectionLabel>Revenue by month</SectionLabel>
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyInline}>
          No revenue recorded yet.
        </AppText>
      </Card>
    );
  }

  return (
    <Card style={styles.sectionCard}>
      <SectionLabel>Revenue by month</SectionLabel>
      {analytics.currencies.map((currency) => {
        const series = recentMonths.map((m) => ({
          month: m.month,
          amountMinor: m.totals.find((t) => t.currency === currency)?.amountMinor ?? 0,
        }));
        const max = Math.max(...series.map((s) => s.amountMinor), 1);
        return (
          <View key={currency} style={styles.currencyBlock}>
            <AppText variant="bodyBold" style={styles.currencyTitle}>
              {currency}
            </AppText>
            {series.map((s) => (
              <BarRow
                key={s.month}
                label={monthLabel(s.month)}
                value={s.amountMinor}
                valueLabel={formatMoney(s.amountMinor, currency)}
                max={max}
              />
            ))}
          </View>
        );
      })}
    </Card>
  );
}

function TierBreakdownCard({ analytics }: { analytics: AdminAnalytics }) {
  const rows = analytics.tierBreakdown;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Card style={styles.sectionCard}>
      <SectionLabel>Members by tier</SectionLabel>
      {rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyInline}>
          No members yet.
        </AppText>
      ) : (
        rows.map((r) => (
          <BarRow
            key={r.tier}
            label={r.tier.charAt(0).toUpperCase() + r.tier.slice(1)}
            value={r.count}
            valueLabel={r.count.toLocaleString()}
            max={max}
          />
        ))
      )}
    </Card>
  );
}

function CountryBreakdownCard({ analytics }: { analytics: AdminAnalytics }) {
  const rows = useMemo(
    () => [...analytics.countryBreakdown].sort((a, b) => b.count - a.count).slice(0, 8),
    [analytics.countryBreakdown],
  );
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Card style={styles.sectionCard}>
      <SectionLabel>Members by country</SectionLabel>
      {rows.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyInline}>
          No country data yet.
        </AppText>
      ) : (
        rows.map((r) => (
          <BarRow
            key={r.country ?? 'unknown'}
            label={r.country ?? 'Unknown'}
            value={r.count}
            valueLabel={r.count.toLocaleString()}
            max={max}
          />
        ))
      )}
    </Card>
  );
}

function PromoRow({ row }: { row: PromoPerformance }) {
  return (
    <View style={styles.listRow}>
      <View style={styles.listRowHead}>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.listRowTitle}>
          {row.code}
        </AppText>
        <Tag
          label={row.active ? 'Active' : 'Inactive'}
          variant={row.active ? 'outline' : 'dim'}
          color={row.active ? colors.success : colors.textFaint}
        />
      </View>
      <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
        {row.ownerName ?? 'No owner'} · {row.commissionPct}% commission
      </AppText>
      <AppText variant="caption" color={colors.textFaint}>
        {row.redemptions} redemption{row.redemptions === 1 ? '' : 's'} · {row.settlements} settled
      </AppText>
      <AppText variant="caption" tabular>
        {moneyList(row.commission)}
      </AppText>
    </View>
  );
}

function CoachRow({ row }: { row: CoachPerformance }) {
  return (
    <View style={styles.listRow}>
      <View style={styles.listRowHead}>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.listRowTitle}>
          {row.displayName}
        </AppText>
        <Tag label={row.coachTier} variant="dim" />
      </View>
      <AppText variant="caption" color={colors.textDim}>
        {row.activeClients} active client{row.activeClients === 1 ? '' : 's'} · {row.totalMilestones}{' '}
        milestone{row.totalMilestones === 1 ? '' : 's'}
      </AppText>
      <AppText variant="caption" tabular>
        {moneyList(row.walletEarned)}
      </AppText>
    </View>
  );
}

export default function AdminAnalyticsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'analytics.read');

  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setAnalytics(await getAdminAnalytics(token));
    } catch (e) {
      setError(errorLine(toStaffError(e).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can view analytics.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : !analytics ? (
        <EmptyState icon="bar-chart" title="No data" body="Analytics couldn't be loaded." />
      ) : (
        <View style={styles.body}>
          <Animated.View entering={enterUp(0)} style={styles.deltaRow}>
            <DeltaTile
              label={`New members (${analytics.deltas.windowDays}d)`}
              current={analytics.deltas.newMembers.current}
              prior={analytics.deltas.newMembers.prior}
            />
            <DeltaTile
              label={`Approved payments (${analytics.deltas.windowDays}d)`}
              current={analytics.deltas.approvedPayments.current}
              prior={analytics.deltas.approvedPayments.prior}
            />
          </Animated.View>

          {analytics.deltas.revenue.length > 0 ? (
            <Animated.View entering={enterUp(1)} style={styles.deltaRow}>
              {analytics.deltas.revenue.map((r) => (
                <DeltaTile
                  key={r.currency}
                  label={`Revenue (${r.currency}, ${analytics.deltas.windowDays}d)`}
                  current={r.current / 100}
                  prior={r.prior / 100}
                  unit={r.currency}
                />
              ))}
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(2)}>
            <RevenueByMonthCard analytics={analytics} />
          </Animated.View>

          <Animated.View entering={enterUp(3)}>
            <TierBreakdownCard analytics={analytics} />
          </Animated.View>

          <Animated.View entering={enterUp(4)}>
            <CountryBreakdownCard analytics={analytics} />
          </Animated.View>

          <Animated.View entering={enterUp(5)}>
            <Card style={styles.sectionCard}>
              <SectionLabel>Promo performance</SectionLabel>
              {analytics.promoPerformance.length === 0 ? (
                <AppText variant="caption" color={colors.textFaint} style={styles.emptyInline}>
                  No promo codes yet.
                </AppText>
              ) : (
                analytics.promoPerformance.map((row) => <PromoRow key={row.codeId} row={row} />)
              )}
            </Card>
          </Animated.View>

          <Animated.View entering={enterUp(6)}>
            <Card style={styles.sectionCard}>
              <SectionLabel>Coach performance</SectionLabel>
              {analytics.coachPerformance.length === 0 ? (
                <AppText variant="caption" color={colors.textFaint} style={styles.emptyInline}>
                  No coaches yet.
                </AppText>
              ) : (
                analytics.coachPerformance.map((row) => <CoachRow key={row.coachId} row={row} />)
              )}
            </Card>
          </Animated.View>

          <AppText variant="caption" color={colors.textFaint} center style={styles.generatedAt}>
            Updated {relativeTime(analytics.generatedAt)}
          </AppText>
        </View>
      )}
    </Screen>
  );
}

/** Shared back row + revamp header. */
function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader eyebrow="Admin console" title="Analytics" style={styles.header} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  body: { gap: spacing.md },
  deltaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  deltaTile: {
    flex: 1,
    minWidth: 150,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  sectionCard: { gap: spacing.sm },
  emptyInline: { paddingVertical: spacing.sm },
  currencyBlock: { gap: spacing.xs, marginTop: spacing.xs },
  currencyTitle: { marginBottom: 2 },
  barRow: { gap: 4 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  barLabel: { flex: 1 },
  listRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceRaised,
  },
  listRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  listRowTitle: { flex: 1 },
  generatedAt: { marginTop: spacing.sm },
});
