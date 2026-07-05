import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  HeroCard,
  PressableScale,
  Screen,
} from '../../components/ui';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import {
  canOpenAdminConsole,
  canOpenCoachConsole,
  pushStaff,
  STAFF_ROUTES,
} from '../../features/staff/nav';
import { roleLabel } from '../../features/staff/roles';
import {
  StaffHeaderAction,
  StaffSignOutDialog,
  switchToMemberApp,
  useStaffSignOut,
} from '../../features/staff/StaffExit';

/**
 * Staff hub — the role-aware entry point for the mobile staff console. Greets
 * the staff member and surfaces a "Coach console" card (coach / super_admin /
 * main_admin)
 * and/or an "Admin console" card (any admin-tier role). Screen agents own the
 * destinations; this screen only routes.
 *
 * Reached via router.replace('/staff') straight after a staff sign-in (skipping
 * onboarding) or from the Settings "Staff console" row.
 */

/** A tappable console card — icon, title, one-line blurb, chevron. */
function ConsoleCard({
  icon,
  title,
  blurb,
  onPress,
  index,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  blurb: string;
  onPress: () => void;
  index: number;
}) {
  return (
    <Animated.View entering={enterUp(index)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={styles.card}
      >
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={22} color={colors.accent} />
        </View>
        <View style={styles.cardText}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" numberOfLines={2}>
            {blurb}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
      </PressableScale>
    </Animated.View>
  );
}

export default function StaffHubScreen() {
  const staffRole = useAuth((s) => s.staffRole);
  const authUser = useAuth((s) => s.user);
  const profileName = useProfile((s) => s.displayName);
  const signOut = useStaffSignOut();

  const firstName =
    (authUser?.displayName?.trim() || profileName.trim() || 'there').split(' ')[0] ?? 'there';

  const showCoach = canOpenCoachConsole(staffRole);
  const showAdmin = canOpenAdminConsole(staffRole);

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        {/* Leave the console for the member app (stay signed in). Replaces the
            old back-chevron, which dead-ended (exited the app) after a fresh
            staff login because the console is the app root then. */}
        <StaffHeaderAction
          icon="arrow-back"
          label="Switch to member app"
          onPress={switchToMemberApp}
        />
        <AppText variant="heading" style={styles.headerTitle}>
          Staff console
        </AppText>
        <StaffHeaderAction
          icon="log-out-outline"
          label="Sign out of the staff console"
          onPress={signOut.requestSignOut}
        />
      </Animated.View>

      <Animated.View entering={enterUp(0)} style={styles.hero}>
        <HeroCard>
          <AppText variant="label">{roleLabel(staffRole)}</AppText>
          <AppText variant="title">Welcome back, {firstName}</AppText>
          <AppText variant="caption">
            Manage your clients and the platform from one place.
          </AppText>
        </HeroCard>
      </Animated.View>

      {showCoach ? (
        <ConsoleCard
          icon="chatbubbles"
          title="Coach console"
          blurb="Your assigned clients, chat threads and coaching profile."
          onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
          index={1}
        />
      ) : null}

      {showAdmin ? (
        <ConsoleCard
          icon="settings-sharp"
          title="Admin console"
          blurb="Members, coaches, subscriptions, videos and the audit trail."
          onPress={() => pushStaff(STAFF_ROUTES.adminHome)}
          index={2}
        />
      ) : null}

      {!showCoach && !showAdmin ? (
        <Animated.View entering={enterUp(1)} style={styles.empty}>
          <AppText variant="caption" center color={colors.textFaint}>
            Your account is staff, but no console is enabled for your role yet.
          </AppText>
        </Animated.View>
      ) : null}

      {/* Explicit console-exit rows — an always-visible way out that never
          dead-ends the app (see StaffExit for the routing rationale). */}
      <Animated.View entering={enterUp(3)} style={styles.exitGroup}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Switch to member app"
          onPress={switchToMemberApp}
          style={styles.exitRow}
        >
          <View style={styles.exitIcon}>
            <Ionicons name="phone-portrait-outline" size={20} color={colors.text} />
          </View>
          <View style={styles.cardText}>
            <AppText variant="bodyBold" numberOfLines={1}>
              Switch to member app
            </AppText>
            <AppText variant="caption" numberOfLines={2}>
              Leave the console for your normal athlete app — you stay signed in.
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
        </PressableScale>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Sign out of the staff console"
          onPress={signOut.requestSignOut}
          style={styles.exitRow}
        >
          <View style={styles.exitIcon}>
            <Ionicons name="log-out-outline" size={20} color={colors.accent} />
          </View>
          <View style={styles.cardText}>
            <AppText variant="bodyBold" numberOfLines={1} color={colors.accent}>
              Sign out
            </AppText>
            <AppText variant="caption" numberOfLines={2}>
              Sign out of your account completely.
            </AppText>
          </View>
        </PressableScale>
      </Animated.View>

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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerTitle: { flex: 1 },
  hero: { marginBottom: spacing.xl },
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
  empty: { marginTop: spacing.xl, paddingHorizontal: spacing.md },
  exitGroup: { marginTop: spacing.xl, gap: spacing.md },
  exitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  exitIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
