import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  UpgradePrompt,
  enterDown,
  enterFade,
  enterUp,
  layoutSpring,
} from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { useProfile } from '../state/profile';

/**
 * /support — Elite priority support in the color-blocked language: back pill →
 * ScreenHeader → ONE red contact block (Elite hero) → charcoal contact rows →
 * the same chat thread (kind 'support'). Lower tiers see the upgrade sell plus
 * the FAQ as a stack of charcoal blocks (no hairlines — fill contrast only).
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
  backRow: { flexDirection: 'row', marginBottom: spacing.md },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.xl },
  gateWrap: { gap: spacing.lg },

  // Unlocked view — red contact block + charcoal contact rows over the thread.
  hero: { marginBottom: spacing.md, gap: spacing.sm },
  heroBody: { marginTop: spacing.xs },
  contactStack: { gap: spacing.sm, marginBottom: spacing.sm },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 64,
  },
  contactText: { flex: 1, gap: 2 },

  // FAQ accordion (gated view) — borderless charcoal blocks in a gapped stack.
  faqStack: { gap: spacing.sm },
  faqCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
  faqAnswer: { paddingBottom: spacing.lg },
});

/** Round charcoal back button above the header block. */
function BackRow() {
  return (
    <Animated.View entering={enterDown()} style={styles.backRow}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </PressableScale>
    </Animated.View>
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
    <View style={styles.faqStack}>
      {FAQ_ITEMS.map((item, i) => {
        const open = openIndex === i;
        return (
          <Animated.View
            key={item.q}
            entering={enterUp(i + 2)}
            layout={layoutSpring}
            style={styles.faqCard}
          >
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
        <BackRow />
        <ScreenHeader eyebrow="Help & answers" title="Priority support" style={styles.header} />
        <Animated.View entering={enterUp(1)} style={styles.gateWrap}>
          <UpgradePrompt
            requiredTier="elite"
            title="Priority support"
            description="Front-of-line help from the GM team whenever you need it."
          />
          <Button label="See plans" onPress={() => router.push('/subscribe' as Href)} />
        </Animated.View>
        <SectionLabel>Common questions</SectionLabel>
        <SupportFaq />
      </Screen>
    );
  }

  return (
    <Screen edges={{ bottom: true }}>
      <BackRow />
      <ScreenHeader eyebrow="GM team" title="Priority support" style={styles.header} />

      <Animated.View entering={enterUp(1)}>
        <Card variant="red" style={styles.hero}>
          <AppText variant="label" color={colors.onBlock}>
            Elite priority
          </AppText>
          <AppText variant="title" color={colors.onBlock}>
            You're at the front of the line
          </AppText>
          <AppText variant="body" color={colors.onBlock} style={styles.heroBody}>
            Send us anything — billing, plans, or a stuck feature. The GM team gets back within a
            few hours.
          </AppText>
        </Card>
      </Animated.View>

      <Animated.View entering={enterUp(2)} style={styles.contactStack}>
        {QUICK_CONTACTS.map((c) => (
          <View key={c.label} style={styles.contactRow}>
            <IconChip icon={c.icon} iconColor={colors.accent} size={40} />
            <View style={styles.contactText}>
              <AppText variant="bodyBold">{c.label}</AppText>
              <AppText variant="caption">{c.value}</AppText>
            </View>
          </View>
        ))}
      </Animated.View>

      <CoachThread
        kind="support"
        emptyTitle="How can we help?"
        emptyBody="Describe your issue and we'll get back within a few hours."
        placeholder="Describe your issue…"
      />
    </Screen>
  );
}
