import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../../../components/ui';
import { useAuth } from '../../../state/auth';
import { type Permission } from '@gym/shared';
import {
  type AdminOverview,
  getAdminOverview,
  toStaffError,
} from '../../../features/staff/api';
import { pushStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import {
  StaffHeaderAction,
  StaffSignOutDialog,
  switchToMemberApp,
  useStaffSignOut,
} from '../../../features/staff/StaffExit';

/**
 * Admin console home. Loads the overview summary (getAdminOverview) into a small
 * stat grid, then lists the admin sub-consoles. Loading is a quiet spinner;
 * an error is a single retry line — no blocking modal. The Roles + Audit rows
 * only render for super_admin/main_admin (the screens re-gate themselves too).
 *
 * Block language (REVAMP-BRIEF): back/action row → ScreenHeader → the ONE red
 * hero block (platform-overview stat grid, Oswald numerals in black ink) →
 * charcoal nav rows, no card borders.
 */

interface NavRow {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  blurb: string;
  route: string;
  /**
   * The permission key that unlocks this row (RBAC design §1.4 / §4.10). The
   * row is hidden unless the server-provided effective list contains `perm`,
   * including account-specific grants and denials.
   * Every row MUST carry one: an ungated card walks a role without the
   * matching permission straight into a dead-end 403 (defect G14).
   */
  perm: Permission;
}

// Three of these routes (pricing/wallets/tier-requests) are NEW parity
// screens built by the WP8b package.
const NAV_ROWS: NavRow[] = [
  {
    icon: 'people',
    title: 'Members',
    blurb: 'Search, change tier, suspend, assign a coach.',
    route: STAFF_ROUTES.adminMembers,
    perm: 'members.read',
  },
  {
    icon: 'barbell',
    title: 'Coaches',
    blurb: 'The coach pool and their active client load.',
    route: STAFF_ROUTES.adminCoaches,
    perm: 'coach.assign',
  },
  {
    icon: 'videocam',
    title: 'Content',
    blurb: 'The plan-video library.',
    route: STAFF_ROUTES.adminVideos,
    perm: 'content.manage',
  },
  {
    icon: 'card',
    title: 'Subscriptions',
    blurb: 'Tier overrides + recent changes.',
    route: STAFF_ROUTES.adminSubscriptions,
    perm: 'subscription.override',
  },
  {
    icon: 'person-add',
    title: 'Applications',
    blurb: 'Review self-serve coach applications.',
    route: STAFF_ROUTES.adminApplications,
    perm: 'coach.application.review',
  },
  {
    icon: 'trending-up',
    title: 'Tier requests',
    blurb: 'Coach seniority upgrade requests awaiting review.',
    route: STAFF_ROUTES.adminTierRequests,
    perm: 'coach.application.review',
  },
  {
    icon: 'wallet',
    title: 'Payments',
    blurb: 'Nepal manual payment receipts awaiting review.',
    route: STAFF_ROUTES.adminPayments,
    perm: 'payments.review',
  },
  {
    icon: 'restaurant',
    title: 'Orders',
    blurb: 'All-partners meal-order oversight — force status or cancel.',
    route: STAFF_ROUTES.adminOrders,
    perm: 'orders.review',
  },
  {
    icon: 'fast-food',
    title: 'Meal payments',
    blurb: 'eSewa/Khalti receipts for meal orders and weekly plans.',
    route: STAFF_ROUTES.adminMealPayments,
    perm: 'payments.review',
  },
  {
    icon: 'pricetag',
    title: 'Promo codes',
    blurb: 'House codes, coach codes, redemption stats.',
    route: STAFF_ROUTES.adminPromos,
    perm: 'promo.manage',
  },
  {
    icon: 'cash',
    title: 'Pricing',
    blurb: 'Regional tier prices (NP NPR / INTL USD).',
    route: STAFF_ROUTES.adminPricing,
    perm: 'pricing.manage',
  },
  {
    icon: 'briefcase',
    title: 'Coach wallets',
    blurb: 'Commission balances, adjustments and payouts.',
    route: STAFF_ROUTES.adminWallets,
    perm: 'wallet.manage',
  },
  {
    icon: 'cash-outline',
    title: 'Payouts',
    blurb: 'Coach withdrawal requests awaiting approval.',
    route: STAFF_ROUTES.adminPayouts,
    perm: 'payouts.review',
  },
  {
    icon: 'chatbubble-ellipses',
    title: 'Support',
    blurb: 'Reply to support tickets from any member.',
    route: STAFF_ROUTES.adminSupport,
    perm: 'support.thread.read',
  },
  {
    icon: 'shield-checkmark',
    title: 'Roles',
    blurb: 'Grant or revoke staff access.',
    route: STAFF_ROUTES.adminStaff,
    perm: 'roles.grant',
  },
  {
    icon: 'receipt',
    title: 'Audit',
    blurb: 'Every privileged action, newest first.',
    route: STAFF_ROUTES.adminAudit,
    perm: 'audit.read',
  },
];

/** One overview cell: Oswald numeral over an eyebrow, black ink on red. */
function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCell}>
      <AppText variant="label" color={colors.onBlock} numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="display" color={colors.onBlock} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

export default function AdminHomeScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const signOut = useStaffSignOut();
  const navRows = NAV_ROWS.filter((row) => staffCan(staffPermissions, row.perm));

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    setLoading(true);
    try {
      setOverview(await getAdminOverview(token));
    } catch (err) {
      // A forbidden role still lands here (the hub gate is advisory) — treat
      // any failure as a quiet retry line rather than crashing the screen.
      toStaffError(err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Refresh on every focus, not just on mount: the hero stats
  // (members/coaches/assignments/videos) go stale after the admin drills into
  // Members/Payments/Content, performs a mutation, and navigates back here.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else pushStaff(STAFF_ROUTES.hub);
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.actionRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.actionSpacer} />
        {/* Leave the console for the member app (stay signed in). */}
        <StaffHeaderAction
          icon="phone-portrait-outline"
          label="Switch to member app"
          onPress={switchToMemberApp}
        />
        <StaffHeaderAction
          icon="log-out-outline"
          label="Sign out of the staff console"
          onPress={signOut.requestSignOut}
        />
      </Animated.View>

      <ScreenHeader eyebrow="Staff console" title="Admin" style={styles.header} />

      {/* The screen's ONE red hero block — the headline stat grid. */}
      <Animated.View entering={enterUp(0)} style={styles.hero}>
        <AppText variant="label" color={colors.onBlock}>
          Platform overview
        </AppText>
        {loading && !overview ? (
          <View style={styles.heroLoading}>
            <ActivityIndicator size="small" color={colors.onBlock} />
          </View>
        ) : error && !overview ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry loading overview"
            onPress={() => void load()}
          >
            <AppText variant="body" color={colors.onBlock} style={styles.heroRetry}>
              Couldn&apos;t load stats — tap to retry
            </AppText>
          </PressableScale>
        ) : overview ? (
          <View style={styles.statGrid}>
            <HeroStat label="Members" value={overview.totalMembers} />
            <HeroStat label="Coaches" value={overview.activeCoaches} />
            <HeroStat label="Assignments" value={overview.activeAssignments} />
            <HeroStat label="Videos" value={overview.readyVideos} />
          </View>
        ) : null}
      </Animated.View>

      <SectionLabel>Manage</SectionLabel>
      {navRows.map((row, i) => (
        <Animated.View key={row.title} entering={enterUp(i + 1)}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={row.title}
            onPress={() => pushStaff(row.route)}
            style={styles.card}
          >
            <IconChip icon={row.icon} iconColor={colors.accent} />
            <View style={styles.cardText}>
              <AppText variant="bodyBold" numberOfLines={1}>
                {row.title}
              </AppText>
              <AppText variant="caption" numberOfLines={2}>
                {row.blurb}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
          </PressableScale>
        </Animated.View>
      ))}

      <StaffSignOutDialog
        confirming={signOut.confirming}
        signingOut={signOut.signingOut}
        confirmSignOut={signOut.confirmSignOut}
        cancelSignOut={signOut.cancelSignOut}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  actionSpacer: { flex: 1 },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  // The one red block (brief §2): flat fill, chunky corners, black ink.
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  heroLoading: { paddingVertical: spacing.lg, alignItems: 'flex-start' },
  heroRetry: { paddingVertical: spacing.sm },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
  },
  statCell: { width: '50%', gap: 2 },
  // Charcoal nav row (brief §11c): fill contrast, no hairlines.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
    marginBottom: spacing.md,
  },
  cardText: { flex: 1, gap: 2 },
});
