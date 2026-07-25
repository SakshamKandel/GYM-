import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
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
import { BASE_URL } from '../lib/api/client';
import { useAuth } from '../state/auth';
import { useEffectiveTier } from '../lib/tier';

/**
 * /support — support messaging in the color-blocked language: back pill →
 * ScreenHeader → ONE red hero block (Elite) or a compact upgrade nudge →
 * the FAQ (every tier) → the chat thread (kind 'support'). Open to EVERY tier
 * (SCALE-UP-PLAN §4.4): the server POST gate for kind='support' relaxed to
 * any signed-in user, so this screen no longer blocks the message section
 * behind Elite — only the hero's priority copy (and the AI concierge
 * auto-reply, server-side) stays Elite-flavored. Non-Elite sends land
 * straight in the admin support inbox for a human reply. The upsell/FAQ sit
 * ABOVE the thread so the thread (a flex:1 FlatList) still gets whatever
 * height is left, same as the Elite hero did before — the FAQ itself starts
 * collapsed behind one toggle row (SupportFaqSection) so it can't crush the
 * thread on small devices.
 *
 * WHAT "PRIORITY" MEANS, EXACTLY. The hero used to promise a reply "within a
 * few hours" while every ticket landed in one flat inbox with no tier attached
 * and no ordering at all — a paid promise with nothing behind it. The ordering
 * is now real: apps/web/src/lib/supportThreads.ts sorts the staff inbox by
 * waiting-first, then Elite above the rest, then longest wait, and the console
 * badges an Elite ticket as "First in line". So this copy now promises the
 * thing the product actually does (your message goes to the top of the list)
 * and no longer promises a clock nobody can guarantee. The screen title also
 * stops calling itself "Priority support" for members who are not paying for
 * priority. If a response-time guarantee is ever agreed, measure it before
 * printing it here.
 */

// WhatsApp and email used to sit here as two rows that both read "Coming
// soon" — a contact list that could not be contacted. They are gone until a
// real channel is wired up; the message thread below is the one that works.

// Common questions for anyone who hasn't unlocked live coaching yet. Plain,
// honest copy — no tier names hardcoded as gating, just descriptive help.
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What do the memberships include?',
    a: 'Starter is free forever. Paid memberships unlock full nutrition tracking and the adaptive GM Method, and the top one adds direct coaching. Tap See GM Method memberships for the full breakdown.',
  },
  {
    q: 'Can I try a membership before paying?',
    a: "Yes. Every paid membership comes with a free trial you can start from the GM Method screen. Cancel before it ends and you won't be charged.",
  },
  {
    q: 'How do I change or cancel my membership?',
    a: 'Open Settings, then Membership. You can switch or cancel any time and keep access until the current period ends.',
  },
  {
    q: 'Is my data safe if I sign out?',
    a: "Your logs live on your phone first. Signing out only disconnects your account. Nothing you've tracked is lost.",
  },
];

/** Short, readable tail of an order id — the full id is noise in a chat
 * message, and support can still match an order on the last few characters. */
function shortOrderId(id: string): string {
  return (id.length > 6 ? id.slice(-6) : id).toUpperCase();
}

/**
 * Ticket lifecycle, read from GET /api/coach/messages?kind=support (additive
 * optional `status` field). Staff can close a ticket from their console, and
 * until now the member had no way to tell — a closed ticket looked exactly like
 * a live one, so people sat waiting for a reply that was never coming. A
 * request that has no lifecycle row yet reads as open.
 *
 * `.optional()` on the field keeps the old payload (no `status`) valid, so an
 * app running against an older API just never shows the banner.
 */
const supportStatusSchema = z.object({ status: z.enum(['open', 'resolved']).optional() });

const STATUS_TIMEOUT_MS = 8_000;

/**
 * NEVER throws: any failure (offline, expired session, unexpected body)
 * resolves to null and the banner simply keeps its last-known state, exactly
 * like the unread badge above — a support screen must not break because a
 * status probe failed.
 */
async function getSupportTicketStatus(token: string): Promise<'open' | 'resolved' | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/coach/messages?kind=support`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const parsed = supportStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.status ?? 'open' : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How often the closed-ticket banner re-checks. Only ever runs WHILE the banner
 * is showing: sending a message reopens the request server-side, so this is
 * what clears the banner a moment after the member replies. An open request
 * polls nothing at all, so the common case costs zero extra requests.
 */
const CLOSED_POLL_MS = 15_000;

/**
 * A meal order's "Contact support" button deep-links here as
 * /support?context=order&orderId=…&reason=… (see meals/orders.tsx →
 * LiveOrderCard). Turn those params into a first-message draft so the member
 * doesn't have to retype why they came — they can still edit or clear it
 * before sending. Anything else (no context, no order id) starts empty.
 */
function orderSupportDraft(params: {
  context?: string;
  orderId?: string;
  reason?: string;
}): string | undefined {
  if (params.context !== 'order') return undefined;
  const id = typeof params.orderId === 'string' ? params.orderId.trim() : '';
  if (id.length === 0) return undefined;
  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
  const about = `About order ${shortOrderId(id)}: `;
  return reason.length > 0 ? `${about}${reason}` : about;
}

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

  // Elite view — red priority block above the thread.
  hero: { marginBottom: spacing.md, gap: spacing.sm },
  heroBody: { marginTop: spacing.xs },

  // Non-elite view — compact upgrade nudge; FAQ accordion above the thread.
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

  // Closed-request notice, directly above the thread.
  closedBanner: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    gap: 2,
  },

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
  const params = useLocalSearchParams<{ context?: string; orderId?: string; reason?: string }>();
  const initialDraft = orderSupportDraft(params);
  const tier = useEffectiveTier();
  const elite = hasEntitlement({ tier }, 'coach_chat');
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);
  const [unread, setUnread] = useState(0);
  // True while the member's last support request is marked closed by staff.
  const [requestClosed, setRequestClosed] = useState(false);

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

  // Closed-request banner. Checked on focus; re-checked only WHILE the request
  // is closed, so the banner disappears on its own once the member's reply
  // reopens it server-side (POST /api/coach/messages does that). A failed check
  // keeps the last-known state and retries, so going offline never flips the
  // banner on or off by accident.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'signedIn' || token === null) {
        setRequestClosed(false);
        return;
      }
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let closed = false;

      const check = async (): Promise<void> => {
        const next = await getSupportTicketStatus(token);
        if (cancelled) return;
        if (next !== null) {
          closed = next === 'resolved';
          setRequestClosed(closed);
        }
        if (closed) timer = setTimeout(() => void check(), CLOSED_POLL_MS);
      };
      void check();

      return () => {
        cancelled = true;
        if (timer !== null) clearTimeout(timer);
      };
    }, [status, token]),
  );

  return (
    <Screen edges={{ bottom: true }}>
      <BackRow />
      <ScreenHeader
        eyebrow={elite ? 'GM team' : 'Help & answers'}
        title={elite ? 'Priority support' : 'Support'}
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
              {
                "Send us anything: billing, your membership, or something that stopped working. Your message sits at the top of the GM team's list, above everyone else waiting."
              }
            </AppText>
          </Card>
        </Animated.View>
      ) : (
        <Animated.View entering={enterUp(1)} style={styles.upsell}>
          <UpgradePrompt
            requiredTier="elite"
            title="Get front-of-line replies"
            description="Elite messages go to the top of the GM team's list. Everyone else can still message us below, and we read every one."
          />
        </Animated.View>
      )}

      <SupportFaqSection />

      {status === 'signedIn' && requestClosed ? (
        <Animated.View entering={enterUp(3)} style={styles.closedBanner}>
          <AppText variant="bodyBold">This request was closed</AppText>
          <AppText variant="caption" color={colors.textDim}>
            {"Send a message to reopen it. We'll pick it up from here."}
          </AppText>
        </Animated.View>
      ) : null}

      {status === 'signedIn' ? (
        <CoachThread
          kind="support"
          emptyTitle="How can we help?"
          emptyBody="Describe your issue and we'll get back to you."
          placeholder="Describe your issue…"
          initialDraft={initialDraft}
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
