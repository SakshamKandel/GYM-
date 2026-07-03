import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
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

/**
 * Staff hub — the role-aware entry point for the mobile staff console. Greets
 * the staff member and surfaces a "Coach console" card (coach / super_admin)
 * and/or an "Admin console" card (any admin-tier role). Screen agents own the
 * destinations; this screen only routes.
 *
 * Reached via router.replace('/staff') straight after a staff sign-in (skipping
 * onboarding) or from the Settings "Staff console" row.
 */

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  member_admin: 'Member admin',
  nutrition_admin: 'Nutrition admin',
  content_admin: 'Content admin',
  support_admin: 'Support admin',
  coach: 'Coach',
};

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

  const firstName =
    (authUser?.displayName?.trim() || profileName.trim() || 'there').split(' ')[0] ?? 'there';

  const showCoach = canOpenCoachConsole(staffRole);
  const showAdmin = canOpenAdminConsole(staffRole);

  function goHome(): void {
    // Leave the console back into the normal athlete app.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to app"
          onPress={goHome}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <AppText variant="heading">Staff console</AppText>
      </Animated.View>

      <Animated.View entering={enterUp(0)} style={styles.hero}>
        <HeroCard>
          <AppText variant="label">
            {staffRole ? (ROLE_LABEL[staffRole] ?? 'Staff') : 'Staff'}
          </AppText>
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
});
