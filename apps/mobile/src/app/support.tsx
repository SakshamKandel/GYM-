import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Divider,
  HeroCard,
  IconChip,
  PressableScale,
  Screen,
  SectionLabel,
  UpgradePrompt,
  enterFade,
  layoutSpring,
} from '../components/ui';
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

// Common questions for anyone who hasn't unlocked live coaching yet. Plain,
// honest copy — no tier names hardcoded as gating, just descriptive help.
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What do the plans include?',
    a: 'Starter is free forever. Paid plans unlock full nutrition tracking, the adaptive GM Method, and — at the top tier — direct coaching. Tap See plans for the full breakdown.',
  },
  {
    q: 'Can I try a plan before paying?',
    a: "Yes. Every paid plan comes with a free trial you can start from the Plans screen. Cancel before it ends and you won't be charged.",
  },
  {
    q: 'How do I change or cancel my plan?',
    a: 'Open Settings, then Subscription. You can switch tiers or cancel any time and keep access until the current period ends.',
  },
  {
    q: 'Is my data safe if I sign out?',
    a: "Your logs live on your phone first. Signing out only disconnects your account — nothing you've tracked is lost.",
  },
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

  // FAQ accordion (gated view) — bordered surface, hairline-split rows.
  faqCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  faqQuestion: { flex: 1, minWidth: 0 },
  faqAnswer: { paddingBottom: spacing.md },
});

function Header({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={styles.header}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </PressableScale>
      <View style={styles.headerText}>
        <AppText variant="title">{title}</AppText>
        {caption ? <AppText variant="caption">{caption}</AppText> : null}
      </View>
    </View>
  );
}

/**
 * Common-questions accordion. Each row is a user-driven expander: tap toggles
 * the answer, which fades in while the row (and those below it) settle via
 * layoutSpring instead of popping. Reduced-motion falls back to the fade.
 */
function SupportFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <View style={styles.faqCard}>
      {FAQ_ITEMS.map((item, i) => {
        const open = openIndex === i;
        return (
          <Animated.View key={item.q} layout={layoutSpring}>
            {i > 0 ? <Divider /> : null}
            <PressableScale
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={item.q}
              onPress={() => setOpenIndex(open ? null : i)}
              style={styles.faqHeader}
            >
              <AppText variant="bodyBold" style={styles.faqQuestion}>
                {item.q}
              </AppText>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textDim}
              />
            </PressableScale>
            {open ? (
              <Animated.View entering={enterFade(0)} style={styles.faqAnswer}>
                <AppText variant="body" color={colors.textDim}>
                  {item.a}
                </AppText>
              </Animated.View>
            ) : null}
          </Animated.View>
        );
      })}
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
        <SectionLabel>Common questions</SectionLabel>
        <SupportFaq />
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
