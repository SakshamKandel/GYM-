import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, HeroCard, IconChip, Screen, UpgradePrompt } from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { useProfile } from '../state/profile';

/**
 * /support — Elite priority support. An Elite hero + the same chat thread
 * (kind 'support') plus quick-contact affordances (WhatsApp/email rows the
 * owner fills in later). Lower tiers see the upgrade sell.
 */

// Owner fills these later — plain placeholders, no dead links wired yet.
const QUICK_CONTACTS: { icon: 'logo-whatsapp' | 'mail-outline'; label: string; value: string }[] = [
  { icon: 'logo-whatsapp', label: 'WhatsApp', value: 'Coming soon' },
  { icon: 'mail-outline', label: 'Email', value: 'Coming soon' },
];

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  gateWrap: { gap: spacing.lg, paddingTop: spacing.xl },
  hero: { marginBottom: spacing.md },
  heroBody: { marginTop: 4 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  contactText: { flex: 1 },
});

function Header({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <View style={styles.headerText}>
        <AppText variant="title">{title}</AppText>
        {caption ? <AppText variant="caption">{caption}</AppText> : null}
      </View>
    </View>
  );
}

export default function SupportScreen() {
  const tier = useProfile((s) => s.tier);
  const unlocked = hasEntitlement({ tier }, 'coach_chat');

  if (!unlocked) {
    return (
      <Screen scroll>
        <Header title="Priority support" />
        <View style={styles.gateWrap}>
          <UpgradePrompt
            requiredTier="elite"
            title="Priority support"
            description="Front-of-line help from the GM team whenever you need it."
          />
          <Button label="See plans" onPress={() => router.push('/subscribe' as Href)} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={{ bottom: true }}>
      <Header title="Priority support" caption="Front-of-line help from the GM team" />

      <HeroCard tone="red" style={styles.hero}>
        <AppText variant="label" color={colors.onAccent}>
          Elite priority
        </AppText>
        <AppText variant="title" color={colors.onAccent}>
          You're at the front of the line
        </AppText>
        <AppText variant="caption" color={colors.onAccent} style={styles.heroBody}>
          Send us anything — billing, plans, or a stuck feature. The GM team gets back within a few
          hours.
        </AppText>

        {QUICK_CONTACTS.map((c) => (
          <View key={c.label} style={styles.contactRow}>
            <IconChip icon={c.icon} color={colors.onAccent} iconColor={colors.accent} size={40} />
            <View style={styles.contactText}>
              <AppText variant="bodyBold" color={colors.onAccent}>
                {c.label}
              </AppText>
              <AppText variant="caption" color={colors.onAccent}>
                {c.value}
              </AppText>
            </View>
          </View>
        ))}
      </HeroCard>

      <CoachThread
        kind="support"
        emptyTitle="How can we help?"
        emptyBody="Describe your issue and we'll get back within a few hours."
        placeholder="Describe your issue…"
      />
    </Screen>
  );
}
