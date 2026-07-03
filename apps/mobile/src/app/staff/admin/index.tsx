import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  HeroCard,
  PressableScale,
  Screen,
  SectionLabel,
  StatBlock,
} from '../../../components/ui';
import { useAuth } from '../../../state/auth';
import {
  type AdminOverview,
  getAdminOverview,
  toStaffError,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';

/**
 * Admin console home. Loads the overview summary (getAdminOverview) into a small
 * stat grid, then lists the admin sub-consoles. Loading is a quiet spinner;
 * an error is a single retry line — no blocking modal.
 */

interface NavRow {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  blurb: string;
  route: string;
}

const NAV_ROWS: NavRow[] = [
  {
    icon: 'people',
    title: 'Members',
    blurb: 'Search, change tier, suspend, assign a coach.',
    route: STAFF_ROUTES.adminMembers,
  },
  {
    icon: 'barbell',
    title: 'Coaches',
    blurb: 'The coach pool and their active client load.',
    route: STAFF_ROUTES.adminCoaches,
  },
  {
    icon: 'videocam',
    title: 'Content',
    blurb: 'The plan-video library.',
    route: STAFF_ROUTES.adminVideos,
  },
  {
    icon: 'card',
    title: 'Subscriptions',
    blurb: 'Tier overrides live on each member.',
    route: STAFF_ROUTES.adminMembers,
  },
  {
    icon: 'shield-checkmark',
    title: 'Roles',
    blurb: 'Grant or revoke staff access.',
    route: STAFF_ROUTES.adminStaff,
  },
  {
    icon: 'receipt',
    title: 'Audit',
    blurb: 'Every privileged action, newest first.',
    route: STAFF_ROUTES.adminAudit,
  },
];

export default function AdminHomeScreen() {
  const token = useAuth((s) => s.token);

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

  useEffect(() => {
    void load();
  }, [load]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else pushStaff(STAFF_ROUTES.hub);
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <AppText variant="heading">Admin</AppText>
      </Animated.View>

      <Animated.View entering={enterUp(0)} style={styles.hero}>
        <HeroCard>
          <AppText variant="label">Platform overview</AppText>
          {loading && !overview ? (
            <View style={styles.heroLoading}>
              <ActivityIndicator size="small" color={colors.textDim} />
            </View>
          ) : error && !overview ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Retry loading overview"
              onPress={() => void load()}
            >
              <AppText variant="caption" color={colors.textDim}>
                Couldn&apos;t load stats — tap to retry
              </AppText>
            </PressableScale>
          ) : overview ? (
            <View style={styles.statGrid}>
              <View style={styles.statCell}>
                <StatBlock label="Members" value={overview.totalMembers} size="display" />
              </View>
              <View style={styles.statCell}>
                <StatBlock label="Coaches" value={overview.activeCoaches} size="display" />
              </View>
              <View style={styles.statCell}>
                <StatBlock
                  label="Assignments"
                  value={overview.activeAssignments}
                  size="display"
                />
              </View>
              <View style={styles.statCell}>
                <StatBlock label="Videos" value={overview.readyVideos} size="display" />
              </View>
            </View>
          ) : null}
        </HeroCard>
      </Animated.View>

      <SectionLabel>Manage</SectionLabel>
      {NAV_ROWS.map((row, i) => (
        <Animated.View key={row.title} entering={enterUp(i + 1)}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={row.title}
            onPress={() => pushStaff(row.route)}
            style={styles.card}
          >
            <View style={styles.cardIcon}>
              <Ionicons name={row.icon} size={20} color={colors.accent} />
            </View>
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
    </Screen>
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
  hero: { marginBottom: spacing.xl },
  heroLoading: { paddingVertical: spacing.lg, alignItems: 'flex-start' },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
    marginTop: spacing.xs,
  },
  statCell: { width: '50%' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 2 },
});
