import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
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
  UpgradePrompt,
  enterDown,
  enterFade,
  enterUp,
  layoutSpring,
} from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { getSupportUnread } from '../features/support/api';
import { useAuth } from '../state/auth';
import { useEffectiveTier } from '../lib/tier';

/**
 * /support — support messaging in the color-blocked language: back pill →
 * ScreenHeader → ONE red hero block (Elite) or a compact upgrade nudge +
 * FAQ (everyone else) → the chat thread (kind 'support'). Open to EVERY tier
 * (SCALE-UP-PLAN §4.4): the server POST gate for kind='support' relaxed to
 * any signed-in user, so this screen no longer blocks the message section
 * behind Elite — only the hero's priority copy (and the AI concierge
 * auto-reply, server-side) stays Elite-flavored. Non-Elite sends land
 * straight in the admin support inbox for a human reply. The upsell/FAQ sit
 * ABOVE the thread so the thread (a flex:1 FlatList) still gets whatever
 * height is left, same as the Elite hero did before — the FAQ itself starts
 * collapsed behind one toggle row (SupportFaqSection) so it can't crush the
 * thread on small devices.
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
  header: { marginBottom: spacing.lg },
  // Outlined pill for the unread meta chip (brief §6 — chips may have a border).
  metaChip: {
    minHeight: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Elite view — red contact block + charcoal contact rows above the thread.
  hero: { marginBottom: spacing.md, gap: spacing.sm },
  heroBody: { marginTop: spacing.xs },
  contactStack: { gap: spacing.sm, marginBottom: spacing.md },
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

  // Non-elite view — compact upgrade nudge + FAQ accordion, above the thread.
  upsell: { marginBottom: spacing.md },
  // The FAQ list starts collapsed behind this single toggle row — on a small
  // device the thread (flex:1) needs the height back; expanding all 4 cards
  // by default left under ~150pt for the message list + input.
  faqSection: { marginBottom: spacing.md },
  faqToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 56,
  },
  faqToggleLabel: { flex: 1 },
  faqStack: { gap: spacing.sm, marginTop: spacing.sm },
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

  // Signed-out placeholder in place of the (auth-only) live thread.
  signInCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
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
 * Common-questions section: collapsed behind one toggle row by default so it
 * doesn't crush the chat thread below on small devices (the thread is the
 * primary reason someone opens /support, not the FAQ). Expanding reveals the
 * per-question accordion.
 */
function SupportFaqSection() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Animated.View entering={enterUp(2)} layout={layoutSpring} style={styles.faqSection}>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Hide common questions' : 'Show common questions'}
        onPress={() => setExpanded((v) => !v)}
        style={styles.faqToggleRow}
      >
        <AppText variant="bodyBold" style={styles.faqToggleLabel}>
          Common questions
        </AppText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textDim}
        />
      </PressableScale>
      {expanded ? <SupportFaq /> : null}
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
  const tier = useEffectiveTier();
  const elite = hasEntitlement({ tier }, 'coach_chat');
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);
  const [unread, setUnread] = useState(0);

  // Unread badge — a plain focus fetch (SCALE-UP-PLAN §5.1), independent of
  // the buddy tab's poll: this screen only needs a fresh count on open, not
  // a live-updating one while the thread below is already visible and
  // reloading on its own.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'signedIn' || token === null) {
        setUnread(0);
        return;
      }
      void getSupportUnread(token).then(setUnread);
    }, [status, token]),
  );

  return (
    <Screen edges={{ bottom: true }}>
      <BackRow />
      <ScreenHeader
        eyebrow={elite ? 'GM team' : 'Help & answers'}
        title="Priority support"
        meta={
          unread > 0 ? (
            <View style={styles.metaChip}>
              <AppText variant="label" color={colors.accent}>
                {unread > 9 ? '9+' : unread} new
              </AppText>
            </View>
          ) : undefined
        }
        style={styles.header}
      />

      {elite ? (
        <Animated.View entering={enterUp(1)}>
          <Card variant="red" style={styles.hero}>
            <AppText variant="label" color={colors.onBlock}>
              Elite priority
            </AppText>
            <AppText variant="title" color={colors.onBlock}>
              {"You're at the front of the line"}
            </AppText>
            <AppText variant="body" color={colors.onBlock} style={styles.heroBody}>
              Send us anything — billing, plans, or a stuck feature. The GM team gets back within a
              few hours.
            </AppText>
          </Card>
        </Animated.View>
      ) : (
        <Animated.View entering={enterUp(1)} style={styles.upsell}>
          <UpgradePrompt
            requiredTier="elite"
            title="Get front-of-line replies"
            description="Elite members hear back from the GM team within a few hours. Everyone else can still message us below — we'll get to it."
          />
        </Animated.View>
      )}

      {elite ? (
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
      ) : (
        <SupportFaqSection />
      )}

      {status === 'signedIn' ? (
        <CoachThread
          kind="support"
          emptyTitle="How can we help?"
          emptyBody="Describe your issue and we'll get back to you."
          placeholder="Describe your issue…"
        />
      ) : (
        <Animated.View entering={enterUp(3)} style={styles.signInCard}>
          <AppText variant="bodyBold">Sign in to message us</AppText>
          <AppText variant="caption">
            Support tickets are tied to your account so we can get back to you.
          </AppText>
          <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
        </Animated.View>
      )}
    </Screen>
  );
}
