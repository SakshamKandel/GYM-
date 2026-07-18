import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
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
 *
 * Block language (REVAMP-BRIEF): utility action row → ScreenHeader → the ONE
 * red hero block (welcome greeting, black ink) → charcoal console rows —
 * fill-contrast separation, no card borders.
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
        <IconChip icon={icon} iconColor={colors.accent} />
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
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const authUser = useAuth((s) => s.user);
  const profileName = useProfile((s) => s.displayName);
  const signOut = useStaffSignOut();

  const firstName =
    (authUser?.displayName?.trim() || profileName.trim() || 'there').split(' ')[0] ?? 'there';

  const showCoach = canOpenCoachConsole(staffPermissions);
  const showAdmin = canOpenAdminConsole(staffPermissions);
  // Partner is a web-only role: its permissions (meals.own / orders.fulfill)
  // grant no mobile console, so both cards are already hidden. Show a clear
  // "manage on the web portal" notice instead of the generic no-console empty
  // state — never the admin/coach consoles.
  const isPartner = staffRole === 'partner';

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.actionRow}>
        {/* Leave the console for the member app (stay signed in). Replaces the
            old back-chevron, which dead-ended (exited the app) after a fresh
            staff login because the console is the app root then. */}
        <StaffHeaderAction
          icon="arrow-back"
          label="Switch to member app"
          onPress={switchToMemberApp}
        />
        <View style={styles.actionSpacer} />
        <StaffHeaderAction
          icon="log-out-outline"
          label="Sign out of the staff console"
          onPress={signOut.requestSignOut}
        />
      </Animated.View>

      <ScreenHeader title="Staff console" style={styles.header} />

      {/* The screen's ONE red hero block — black ink on red (brief §2). */}
      <Animated.View entering={enterUp(0)} style={styles.hero}>
        <AppText variant="label" color={colors.onBlock}>
          {roleLabel(staffRole)}
        </AppText>
        <AppText variant="title" color={colors.onBlock}>
          Welcome back, {firstName}
        </AppText>
        <AppText variant="body" color={colors.onBlock} style={styles.heroCopy}>
          Manage your clients and the platform from one place.
        </AppText>
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

      {isPartner ? (
        <Animated.View entering={enterUp(1)} style={styles.notice}>
          <IconChip icon="globe-outline" iconColor={colors.accent} />
          <View style={styles.cardText}>
            <AppText variant="bodyBold" numberOfLines={1}>
              Manage your restaurant on the web
            </AppText>
            <AppText variant="caption">
              The partner portal — today&apos;s orders, your menu, subscriptions and
              earnings — is on the web. Sign in at the partner portal from a browser.
            </AppText>
          </View>
        </Animated.View>
      ) : !showCoach && !showAdmin ? (
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
          style={styles.card}
        >
          <IconChip icon="phone-portrait-outline" />
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
          style={styles.card}
        >
          <IconChip icon="log-out-outline" iconColor={colors.accent} />
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  actionSpacer: { flex: 1 },
  header: { marginBottom: spacing.gutter },
  // The one red block: sticker-chunky, flat fill, no border (brief §1/§3).
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  heroCopy: { opacity: 0.75 },
  // Charcoal list row (brief §11c): fill contrast, no hairlines.
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
  // Partner web-portal notice — same charcoal fill-contrast row as the console
  // cards, but non-interactive (no chevron): there is nothing to route to.
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
    marginBottom: spacing.md,
  },
  empty: { marginTop: spacing.xl, paddingHorizontal: spacing.md },
  exitGroup: { marginTop: spacing.xl },
});
