import { Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
} from '../components/ui';
import { MembershipCardAny } from '../features/subscription/components/MembershipCardAny';
import { tierExpiryInfo } from '../features/subscription/logic';
import { useMealPartners, useMyMealOrders } from '../features/meals/hooks';
import { useAuth } from '../state/auth';
import { useProfile } from '../state/profile';

/**
 * /membership-card — a dedicated, full-screen membership card for showing in
 * person: whichever card face the member picked in Settings
 * (MembershipCardAny), enlarged, the member code spelled out in full (not
 * just the last 4), and the member-discount pitch for the restaurant of the
 * member's current meal order (next upcoming order's partner, else the most
 * recent past one) — show the card there to claim the member discount.
 *
 * No QR/barcode graphic — there's no scanner-verified encoder in this app
 * yet (no QR/barcode library is installed, and a hand-rolled one can't be
 * verified against a real scanner from here), so this ships the HONEST
 * version: a large, staff-typeable member code. A real scannable code is a
 * follow-up once expo-camera-side scanning + a vetted encoder land together
 * (Wallet passes are explicitly deferred per §6; this fills the gap without
 * shipping a code that might not actually scan).
 */
export default function MembershipCardScreen() {
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const displayName = useProfile((s) => s.displayName);

  const tier = user?.tier ?? 'starter';
  const memberId = user?.id ?? null;
  const holderName = displayName || user?.displayName || 'Athlete';
  const expiry = tierExpiryInfo(user?.tierExpiresAt ?? null);

  // "Selected restaurant": the next upcoming meal order's partner, else the
  // most recent past one — the place the member is actually walking into.
  const authed = signedIn && token ? token : null;
  const upcomingOrders = useMyMealOrders(authed, 'upcoming');
  const pastOrders = useMyMealOrders(authed, 'history');
  const partners = useMealPartners(authed);
  const discountOrder = upcomingOrders.data?.[0] ?? pastOrders.data?.[0] ?? null;
  const discountPartner = discountOrder
    ? (partners.data?.find((p) => p.id === discountOrder.partnerId)?.name ?? null)
    : null;

  const fullCode = memberId ? memberId.replace(/-/g, '').toUpperCase() : null;
  /** Grouped in fours so the long code wraps cleanly instead of overflowing. */
  const codeDisplay = fullCode ? (fullCode.match(/.{1,4}/g) ?? [fullCode]).join(' ') : null;

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  async function share(): Promise<void> {
    if (!fullCode) return;
    try {
      await Share.share({
        message: `${holderName} — GM Method ${tier.toUpperCase()} member\nMember code: ${fullCode}`,
      });
    } catch {
      // Share sheet dismissed/unavailable — the code stays visible on screen.
    }
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Show it, claim your perks" title="Membership card" style={styles.header} />

      <Animated.View entering={enterUp(0)} style={styles.cardWrap}>
        <MembershipCardAny
          tier={tier}
          holderName={holderName}
          memberId={memberId}
          signedIn={signedIn}
          expiresAt={user?.tierExpiresAt ?? null}
        />
      </Animated.View>

      {!signedIn ? (
        <Animated.View entering={enterUp(1)} style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textFaint} />
          <AppText variant="caption" color={colors.textFaint} style={styles.noticeText}>
            This is a local preview — sign in to get a real member code staff can look up.
          </AppText>
        </Animated.View>
      ) : (
        <>
          <Animated.View entering={enterUp(1)} style={styles.codeBlock}>
            <AppText variant="label" color={colors.textFaint}>
              MEMBER CODE
            </AppText>
            <AppText variant="display" tabular style={styles.codeText}>
              {codeDisplay}
            </AppText>
            <AppText variant="caption" color={colors.textDim} center>
              Your unique member code — it verifies your membership wherever GM Method perks
              apply.
            </AppText>
          </Animated.View>

          <Animated.View entering={enterUp(2)} style={styles.discountBlock}>
            <View style={styles.discountHead}>
              <Ionicons name="restaurant-outline" size={18} color={colors.accent} />
              <AppText variant="label" color={colors.textFaint}>
                MEMBER DISCOUNT
              </AppText>
            </View>
            <AppText variant="bodyBold">{discountPartner ?? 'Partner restaurants'}</AppText>
            <AppText variant="caption" color={colors.textDim}>
              {discountPartner
                ? `Show this card at ${discountPartner} — the restaurant on your meal order — to claim your member discount.`
                : 'Order from a partner restaurant in Meals, then show this card there to claim your member discount.'}
            </AppText>
          </Animated.View>

          {expiry.dateLabel && tier !== 'starter' ? (
            <Animated.View entering={enterUp(3)} style={styles.expiryRow}>
              <Ionicons
                name={expiry.expired ? 'alert-circle-outline' : 'calendar-outline'}
                size={18}
                color={expiry.expired ? colors.error : colors.textDim}
              />
              <AppText variant="caption" color={expiry.expired ? colors.error : colors.textDim}>
                {expiry.expired
                  ? `Membership expired ${expiry.dateLabel}`
                  : `Valid through ${expiry.dateLabel}`}
              </AppText>
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(4)} style={styles.actions}>
            <Button label="Share" variant="secondary" onPress={() => void share()} />
          </Animated.View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  cardWrap: { marginBottom: spacing.xl },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { flex: 1 },
  codeBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.gutter,
    gap: spacing.xs,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  /* Sized + centered so the grouped code wraps to tidy lines instead of
     running off the card block on narrow screens. */
  codeText: { fontSize: 24, lineHeight: 32, letterSpacing: 2, textAlign: 'center' },
  discountBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.gutter,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  discountHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  actions: { marginBottom: spacing.xl },
});
