import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatMoney, type Tier } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  HeroCard,
  PhotoHero,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  stockImages,
  Tag,
  enterFade,
  enterUp,
} from '../../components/ui';
import { PayeeDetailsCard } from '../../components/payments/PayeeDetailsCard';
import { supportsRail, type Payee, type PayeeRail } from '../../lib/api/payee';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { syncProfileNow } from '../../lib/profileSync';
import { tierName, useEffectiveTier } from '../../lib/tier';
import { applyServerUser, useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { activateTrial, trialErrorLine, TRIAL_TIERS } from './trial';
import {
  getPaymentRequests,
  getSubscriptionCatalog,
  getTrialStatus,
  redeemPromoCode,
  reserveImageUpload,
  setSubscriptionTier,
  submitPaymentRequest,
  toApiError,
  uploadImageAsset,
  type PaymentMethod,
  type PaymentRequestRow,
  type PayableTier,
  type SubscriptionCatalog,
  type Trial,
  type TrialTier,
} from '../../lib/api/client';
import {
  GM_TIERS,
  RECOMMENDED_TIER,
  regionHint,
  tierExpiryInfo,
  tierPriceDisplay,
  type GmTier,
} from './logic';
import { TierCard } from './components/TierCard';
import { TierDetailSheet, type TierDetail } from './TierDetailSheet';
import { useStoreBilling, type StoreBilling } from './storeBilling';
import { StorePurchaseSheet, StoreRestoreCard } from './StorePurchase';

/**
 * The GM Method paywall in the color-block language (REVAMP-BRIEF): huge
 * Oswald header, one charcoal pitch block with the mascot, then the tiers as
 * borderless color blocks. The recommended tier is THE screen's red hero —
 * black ink, black pill CTA — everything else stays charcoal. Nothing golden,
 * ever.
 *
 * Pricing (SCALE-UP-PLAN §1.1/§4.1/§5.1): live regional prices + any active
 * discount come from GET /api/subscription/catalog while signed in. Signed-out,
 * offline, or incomplete catalogs show pricing as unavailable. GM_TIERS keeps
 * feature copy only; price is never read from compiled data.
 *
 * A promo code can be redeemed inline (refetches the catalog on success).
 *
 * Whenever the server is NOT in preview mode, every signed-in member sees the
 * manual payment flow: pick a plan + duration, attach a receipt photo, submit
 * for admin review — the amount is always computed server-side from the live
 * catalog. It used to be shown to Nepal accounts only, while everyone else was
 * pointed at an app store that does not exist yet, so a member outside Nepal
 * could not buy any paid tier at all. The rail itself was never regional (the
 * server takes these requests from anywhere); only the METHODS are, so Nepal
 * sees the local wallets and everywhere else sees bank transfer.
 *
 * A paid tier is applied optimistically only when the server explicitly
 * advertises non-production preview mode; otherwise the real store/manual
 * payment path is required.
 *
 * Store purchases (2026-07-25): when the server reports live billing AND this
 * build can really sell through Apple or Google (see storeBilling.ts), a tap on
 * a tier opens the store sheet instead, and a restore row appears under the
 * cards. This screen still never grants a tier: the payment happens in the
 * store, RevenueCat's webhook tells the server, and the sheet says plainly when
 * that confirmation has not landed yet. The receipt rail below is untouched and
 * keeps working exactly as before, including alongside the stores.
 *
 * One chosen plan (2026-07-25): the tier a member taps "Choose" on is the tier
 * the payment form below submits. The form used to keep its own selection,
 * always starting on Silver, so a member who chose Elite and then paid the
 * amount the form showed bought the cheapest membership instead. The form's
 * plan chips stay tappable — the tap upstairs only sets the starting point —
 * and the plan, the duration and the amount are all named on the total block
 * directly above the Submit button.
 *
 * Where the money goes (2026-07-25): the manual rail is offered only for
 * methods the operator has actually published a destination for, and the
 * destination is shown right above the receipt uploader. This screen used to
 * name eSewa, Khalti or "bank transfer" and ask for a receipt while no wallet
 * or account existed anywhere in the product — the instruction could not be
 * carried out. With nothing configured the section now says so in one line
 * instead of asking for a transfer to nobody.
 */

export function SubscribeScreen() {
  // Effective tier (server wins while signed in): a lapsed trial/dated tier
  // must show its old tier as choosable again, not as a CTA-less "Current".
  const currentTier = useEffectiveTier();
  const update = useProfile((s) => s.update);
  const [previewActive, setPreviewActive] = useState(false);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [trialDays, setTrialDays] = useState(2);
  const [trialing, setTrialing] = useState<string | null>(null);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [trialSuccess, setTrialSuccess] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  const [detail, setDetail] = useState<TierDetail | null>(null);
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  // The server-authoritative user carries the RAW tierExpiresAt (Pack J) — drives
  // the expiry/renew banner. Effective tier collapses to starter once past, so
  // this is the only signal that a paid window is ending or has ended.
  const authUser = useAuth((s) => s.user);

  const [catalog, setCatalog] = useState<SubscriptionCatalog | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestRow[]>([]);
  // App-store purchases. Reports itself unavailable unless a membership can
  // really be bought right now, so nothing below turns into a dead button.
  const store = useStoreBilling(catalog);
  const [storeTier, setStoreTier] = useState<Tier | null>(null);
  // The tier the member picked upstairs, carried into the manual payment form
  // below so the plan they chose is the plan they pay for. Silver is only the
  // starting point before any choice is made.
  const [payTier, setPayTier] = useState<PayableTier>('silver');
  // Where members send the money. Null with `payeeLoading` false means nothing
  // is published, and the manual rail is not offered at all.
  //
  // It rides along on the catalog this screen already waits for (see
  // `catalogSchema` in lib/api/client), so it is read from there instead of
  // asking GET /api/subscription/catalog a second time for the same field.
  const payee = catalog?.payee ?? null;
  const payeeLoading = status === 'signedIn' && Boolean(token) && catalog === null;
  const methods = payableMethods(catalog?.region ?? null, payee);

  const fetchTrials = useCallback(async () => {
    if (status !== 'signedIn' || !token) return;
    try {
      const result = await getTrialStatus(token);
      setTrials(result.trials);
      setTrialDays(result.trialDays);
    } catch {
      // Silent — trial UI just won't show status.
    }
  }, [status, token]);

  const fetchCatalog = useCallback(async () => {
    if (status !== 'signedIn' || !token) {
      setCatalog(null);
      return;
    }
    try {
      const result = await getSubscriptionCatalog(token, regionHint());
      setCatalog(result);
    } catch {
      // Keep the last validated catalog for this account; when none exists the
      // tier cards render an explicit unavailable state.
    }
  }, [status, token]);

  const fetchPaymentRequests = useCallback(async () => {
    if (status !== 'signedIn' || !token) {
      setPaymentRequests([]);
      return;
    }
    try {
      setPaymentRequests(await getPaymentRequests(token));
    } catch {
      // Keep the last-known list — the status card just won't update this pass.
    }
  }, [status, token]);

  // Refresh trial status, the pricing catalog and any payment-request status
  // card every time the paywall gains focus (first mount, or coming back from
  // the receipt picker / another tab) — not just once on mount.
  useFocusEffect(
    useCallback(() => {
      void fetchTrials();
      void fetchCatalog();
      void fetchPaymentRequests();
    }, [fetchTrials, fetchCatalog, fetchPaymentRequests]),
  );

  // Resolved once per render and used in both places: the notice above the
  // cards (before the tap) and `choose`'s backstop (after it).
  const purchaseBlock = purchaseBlockMessage(
    status === 'signedIn' && Boolean(token),
    catalog,
    methods,
    payeeLoading,
    store,
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function choose(tier: Tier): void {
    if (tier === currentTier) return;
    setPlanError(null);
    setCancelNote(null);

    // Downgrade to free = cancel. Confirm explicitly, and honor period-end
    // semantics: a paid window already paid for keeps access until it lapses
    // (the server decides and reports the date). No optimistic local change —
    // the confirm dialog is the deliberate pause, so there's nothing to flicker.
    if (tier === 'starter') {
      const info = tierExpiryInfo(authUser?.tierExpiresAt);
      const keepsAccess =
        !info.expired && info.dateLabel !== null && (info.daysLeft ?? 0) > 0;
      Alert.alert(
        'Cancel your membership?',
        keepsAccess
          ? `You'll keep your current benefits until ${info.dateLabel}, then move to the free Starter membership. You won't be charged again.`
          : "You'll move to the free Starter membership. You can re-subscribe any time.",
        [
          { text: 'Keep membership', style: 'cancel' },
          {
            text: 'Cancel membership',
            style: 'destructive',
            onPress: () => applyTierChange('starter'),
          },
        ],
      );
      return;
    }

    // A paid pick. Whatever rail ends up taking the money, this is the plan the
    // member asked for, so the payment form below starts on it.
    setPayTier(tier);

    // The stores can sell this. Take the tap there: the payment happens in the
    // App Store or Google Play, and the membership is switched on by the server
    // when the store confirms it (never by this screen).
    if (store.available) {
      if (!store.canBuy(tier)) {
        warnHaptic();
        setPlanError(
          `${tierName(tier)} isn’t on sale in your store yet. Please check back soon.`,
        );
        return;
      }
      store.reset();
      setStoreTier(tier);
      return;
    }

    // Paid pick while the server runs LIVE billing → the self-serve endpoint
    // 402s every paid tier. Pre-detect it (B23): show the honest affordance
    // instead of optimistically applying then reverting on the rejection. The
    // same message is already on screen above the cards — this is the backstop
    // for a card that was tapped before the catalog changed underneath it.
    // Same function, same inputs, so the two can never disagree; the tap-time
    // copy just names the plan the member picked.
    const tapBlock = purchaseBlockMessage(
      status === 'signedIn' && Boolean(token),
      catalog,
      methods,
      payeeLoading,
      store,
      tier,
    );
    if (tapBlock !== null) {
      warnHaptic();
      setPlanError(tapBlock);
      return;
    }

    // Same price authority the card CTA uses to disable itself: a tier with no
    // published price for this region can't be started even when the rest of
    // the catalog is fine.
    if (!tierPriceDisplay(tier, catalog).available) {
      warnHaptic();
      setPlanError('That membership isn’t available in your region right now.');
      return;
    }

    applyTierChange(tier);
  }

  /**
   * Apply a tier change after `choose` verifies the server-advertised billing
   * mode. A paid choice still rolls back unless the API confirms it.
   * Paid picks apply optimistically for instant UI and roll back on failure; a
   * cancel waits for the server so the period-end date is authoritative.
   */
  function applyTierChange(tier: Tier): void {
    const previousTier = useProfile.getState().tier;
    const optimistic = tier !== 'starter';
    if (optimistic) {
      // Optimistic local apply for instant UI; the profile blob backup keeps
      // preferences in sync (the server ignores its tier field — the account
      // tier is only ever written through POST /api/subscription/tier below).
      update({ tier });
      syncProfileNow();
      setPreviewActive(true);
      successHaptic();
    }

    // Defensive auth re-check in case the account signed out between the tap
    // and this call. Never keep an unconfirmed local tier.
    if (status !== 'signedIn' || !token) {
      if (optimistic && useProfile.getState().tier === tier) update({ tier: previousTier });
      setPreviewActive(false);
      setPlanError('Sign in to change your membership.');
      return;
    }

    // Signed in → the server is the tier authority. Persist the choice and adopt
    // the returned user so everything reading useAuth's tier (home tier ring,
    // server-gated screens) updates now — not on the next app foreground.
    void (async () => {
      try {
        const { user, effectiveAt } = await setSubscriptionTier(token, tier);
        applyServerUser(user, token);
        if (tier === 'starter') {
          const info = tierExpiryInfo(effectiveAt);
          setCancelNote(
            !info.expired && info.dateLabel !== null && (info.daysLeft ?? 0) > 0
              ? `Membership cancelled. You keep access until ${info.dateLabel}.`
              : 'Your membership has been cancelled.',
          );
          successHaptic();
        }
      } catch (err) {
        // Roll back the optimistic write — but never clobber a NEWER pick
        // (rapid re-taps) or another account's state (signed out mid-flight).
        if (useAuth.getState().token !== token) return;
        if (optimistic && useProfile.getState().tier === tier) {
          update({ tier: previousTier });
          syncProfileNow();
        }
        setPreviewActive(false);
        setPlanError(
          ['billing_required', 'billing_unavailable'].includes(toApiError(err).code)
            ? // Only point at the payment section when there IS one — with no
              // published payment details it is not on screen.
              methods.length > 0
              ? 'We could not start this membership in the app. Please use the payment options shown below, or contact support.'
              : 'We could not start this membership in the app. Please contact support.'
            : "Your membership couldn't be updated. Check your connection and try again.",
        );
        warnHaptic();
      }
    })();
  }

  async function startTrialFlow(tier: TrialTier): Promise<void> {
    setTrialing(tier);
    setTrialError(null);
    setTrialSuccess(null);
    const code = await activateTrial(tier);
    setTrialing(null);
    if (code === null) {
      const name = tier.charAt(0).toUpperCase() + tier.slice(1);
      setTrialSuccess(`${name} trial activated for ${trialDays} days!`);
      successHaptic();
      void fetchTrials();
    } else {
      setTrialError(trialErrorLine(code));
    }
  }

  const trialedTiers = new Set(trials.map((t) => t.tier));
  const activeTrial = trials.find((t) => t.active);

  /** Open the tap-to-reveal detail sheet with this tier's resolved perks,
   * live price and current trial status (computed here so the sheet stays
   * catalog/trial-free). */
  function openDetail(t: GmTier): void {
    const canTrial = TRIAL_TIERS.includes(t.tier as TrialTier);
    const isActive = activeTrial?.tier === t.tier;
    const used = trialedTiers.has(t.tier as TrialTier);
    const trialLine = canTrial
      ? isActive
        ? 'Free trial active now'
        : used
          ? 'Free trial already used'
          : `Includes a ${trialDays}-day free trial`
      : null;
    setDetail({
      gmTier: t,
      isCurrent: t.tier === currentTier,
      isRecommended: t.tier === RECOMMENDED_TIER,
      trialLine,
      price: tierPriceDisplay(t.tier, catalog),
    });
  }

  // Expiry / renewal banner (Pack J). The raw tierExpiresAt is present even
  // after it lapses (effective tier is already 'starter' then), so this catches
  // both "ends in N days" and "ended — renew".
  const expiry = tierExpiryInfo(authUser?.tierExpiresAt);
  const showExpiryBanner =
    status === 'signedIn' &&
    expiry.dateLabel !== null &&
    (expiry.expired || (expiry.daysLeft !== null && expiry.daysLeft <= 14));
  const expiryBannerText = expiry.expired
    ? `Your membership ended on ${expiry.dateLabel}. Choose a membership below to renew.`
    : `Your ${tierName(currentTier)} membership ends in ${expiry.daysLeft} ${
        expiry.daysLeft === 1 ? 'day' : 'days'
      } (${expiry.dateLabel}). Renew to keep your benefits.`;

  return (
    <Screen scroll keyboardAware>
      <ScreenHeader
        title="The GM Method"
        action={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={goBack}
            style={styles.backBtn}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </PressableScale>
        }
      />

      {/* Mood banner — decorative dark stock photo under the shared photo-hero
          treatment (scrim + red chip + white ink). Sits above the charcoal
          pitch block; the pitch and tiers carry the real information. */}
      <Animated.View entering={enterUp(0)} style={styles.banner}>
        <PhotoHero
          source={stockImages.deadliftDark}
          size="banner"
          recyclingKey="subscribe-banner"
          accessibilityLabel="A lifter gripping a loaded barbell mid-deadlift"
          chip={{ label: 'GM Method' }}
          title="Built to make you stronger"
          caption="Adaptive training that changes with your body."
        />
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.pitchWrap}>
        <HeroCard mascot variant="charcoal">
          <AppText variant="title">Train the way Greece Maharjan grows</AppText>
          <AppText variant="caption">
            Not generic macros. A method that adapts to your body every week.
          </AppText>
        </HeroCard>
        <AppText variant="caption" color={colors.textDim} style={styles.pricingNote}>
          {trialDays}-day free trial on every membership · monthly or discounted annual billing
        </AppText>
        {previewActive ? (
          <Animated.View entering={enterFade()}>
            <AppText variant="caption" style={styles.previewNote}>
              Payments launch with the app-store release. Your membership is
              active for preview.
            </AppText>
          </Animated.View>
        ) : null}
        {trialSuccess ? (
          <Animated.View entering={enterFade()}>
            <AppText variant="caption" style={styles.previewNote}>
              {trialSuccess}
            </AppText>
          </Animated.View>
        ) : null}
        {trialError ? (
          <AppText variant="caption" color={colors.error} style={styles.previewNote}>
            {trialError}
          </AppText>
        ) : null}
        {planError ? (
          <AppText variant="caption" color={colors.error} style={styles.planErrorNote}>
            {planError}
          </AppText>
        ) : null}
        {cancelNote ? (
          <Animated.View entering={enterFade()}>
            <AppText variant="caption" style={styles.previewNote}>
              {cancelNote}
            </AppText>
          </Animated.View>
        ) : null}
        {showExpiryBanner ? (
          <View style={[styles.expiryBanner, expiry.expired && styles.expiryBannerExpired]}>
            <Ionicons
              name={expiry.expired ? 'alert-circle' : 'time-outline'}
              size={16}
              color={expiry.expired ? colors.error : colors.warning}
            />
            <AppText
              variant="caption"
              color={expiry.expired ? colors.error : colors.warning}
              style={styles.expiryText}
            >
              {expiryBannerText}
            </AppText>
          </View>
        ) : null}
        {activeTrial ? (
          <View style={styles.activeTrialBanner}>
            <Ionicons name="time" size={16} color={colors.success} />
            <AppText variant="caption" color={colors.success}>
              {tierName(activeTrial.tier)} trial active until{' '}
              {new Date(activeTrial.expiresAt).toLocaleDateString()}
            </AppText>
          </View>
        ) : null}
      </Animated.View>

      {status === 'signedIn' && token ? (
        <Animated.View entering={enterFade()} style={styles.promoWrap}>
          <PromoCodeCard token={token} onRedeemed={fetchCatalog} />
        </Animated.View>
      ) : null}

      <View style={styles.cards}>
        {/* Honest before the tap: when the catalog says memberships can't be started
            in the app, say so here rather than letting a Choose tap bounce off
            an error the member has to scroll back up to read. */}
        {purchaseBlock ? (
          <View style={styles.planNotice}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textDim} />
            <AppText variant="caption" color={colors.textDim} style={styles.planNoticeText}>
              {purchaseBlock}
            </AppText>
          </View>
        ) : null}
        {GM_TIERS.map((t, i) => (
          <TierCard
            key={t.tier}
            gmTier={t}
            index={i}
            currentTier={currentTier}
            catalog={catalog}
            onChoose={choose}
            trialDays={trialDays}
            trialed={trialedTiers.has(t.tier as TrialTier)}
            isTrialActive={activeTrial?.tier === t.tier}
            trialing={trialing}
            onTrial={startTrialFlow}
            onOpenDetail={openDetail}
            signedIn={status === 'signedIn'}
          />
        ))}
      </View>

      {/* Shown only when the stores can really sell a membership here. */}
      <StoreRestoreCard store={store} />

      {/* Every signed-in member, every region: the receipt rail, which stays
          exactly as it was. Hidden in preview (a tap on a tier card
          already applies it, so asking for a receipt would be odd), and hidden
          when the region has no published paid price, because then there is no
          amount to pay. The form inside also needs somewhere to send the money:
          with no published payment details it is replaced by one honest line. */}
      {status === 'signedIn' &&
      token &&
      catalog &&
      catalog.billingMode !== 'preview' &&
      catalog.tiers.some((t) => t.tier !== 'starter') ? (
        <Animated.View entering={enterUp(GM_TIERS.length + 1)} style={styles.paymentWrap}>
          <SectionLabel>{paymentSectionTitle(methods)}</SectionLabel>
          {payeeLoading ? (
            <AppText variant="caption" color={colors.textDim}>
              Getting the payment details…
            </AppText>
          ) : methods.length === 0 ? (
            // Nothing published to pay INTO. Say so once, plainly, and don't
            // ask anyone to transfer money or attach a receipt.
            <AppText variant="caption" color={colors.textDim}>
              You can’t pay for a membership in the app just yet. Please check back soon.
            </AppText>
          ) : (
            <AppText variant="caption" color={colors.textDim}>
              Pick a membership, send the money to the details below, then upload your receipt for
              review. Reviews are usually completed within 24 hours.
            </AppText>
          )}
          {paymentRequests.length > 0 ? (
            <PaymentHistory requests={paymentRequests} />
          ) : null}
          {payee && methods.length > 0 ? (
            <ManualPaymentSection
              token={token}
              catalog={catalog}
              payee={payee}
              methods={methods}
              tier={payTier}
              onTierChange={setPayTier}
              onSubmitted={fetchPaymentRequests}
            />
          ) : null}
        </Animated.View>
      ) : null}

      <TierDetailSheet detail={detail} onClose={() => setDetail(null)} />

      <StorePurchaseSheet store={store} tier={storeTier} onClose={() => setStoreTier(null)} />
    </Screen>
  );
}

/**
 * Why a paid membership can't be started with a tap right now, in plain words — or
 * `null` when paid picks work normally.
 *
 * The catalog is the authority (published prices for the region + the server's
 * billing mode). The screen renders this ABOVE the tier cards so the paywall is
 * honest BEFORE the tap, and `choose` reuses the very same copy as its
 * backstop, so the pre-tap notice and the tap-time error can never disagree.
 */
function purchaseBlockMessage(
  signedIn: boolean,
  catalog: SubscriptionCatalog | null,
  methods: PaymentMethodOption[],
  payeeLoading: boolean,
  store: StoreBilling,
  /** The tier just tapped, when there is one — only changes the wording. */
  tier?: Tier,
): string | null {
  if (!signedIn) return 'Sign in to view live pricing and choose a membership.';
  // No validated catalog for this account (offline, or nothing published) —
  // the cards already render their price as unavailable.
  if (!catalog) return 'Live pricing is unavailable. Check your connection and try again.';
  // A region with no published paid prices at all can't sell anything here.
  if (!catalog.tiers.some((t) => t.tier !== 'starter')) {
    return 'Memberships aren’t available in your region yet. Please check back soon.';
  }
  if (catalog.billingMode === 'preview') return null;
  // Still finding out what the stores can sell — claim nothing either way yet.
  if (store.loading) return null;
  // A tap on a tier card opens the store, so there is nothing to warn about.
  if (store.available) return null;
  // Still finding out where money can be sent — claim nothing either way yet.
  if (payeeLoading) return null;
  // Outside preview a tap can't start a membership anywhere, so point at the
  // section that CAN. This used to send everyone outside Nepal to an app store
  // that isn't live yet, which left them with no way to pay at all — and then
  // pointed everyone at payment rails with no destination behind them.
  if (methods.length === 0) {
    return 'You can’t buy a membership in the app just yet. Please check back soon.';
  }
  return `Pay for ${tier ? tierName(tier) : 'this membership'} with ${methodPhrase(methods)} below, then upload your receipt for review.`;
}

/** Heading for the manual payment section, named after the live rails. */
function paymentSectionTitle(methods: PaymentMethodOption[]): string {
  if (methods.length === 0) return 'Paying for a membership';
  return `Pay with ${methodPhrase(methods)}`;
}

/** "eSewa", "eSewa or Khalti", "eSewa, Khalti or bank transfer". */
function methodPhrase(methods: PaymentMethodOption[]): string {
  const names = methods.map((m) => m.phrase);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

// ── Promo code entry ──────────────────────────────────────────────

/** Friendly line for a redeem failure. */
function promoErrorLine(code: string): string {
  switch (code) {
    case 'invalid_code':
      return "That code isn't valid.";
    case 'already_used':
      return "You've already used this code.";
    case 'expired':
      return 'This code has expired or reached its redemption limit.';
    case 'unauthorized':
      return 'Your session expired. Sign in again to continue.';
    default:
      return "That code couldn't be checked. Check your connection and try again.";
  }
}

function PromoCodeCard({
  token,
  onRedeemed,
}: {
  token: string;
  onRedeemed: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: 'dim' | 'error' | 'success' } | null>(
    null,
  );

  function submit(): void {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setLine(null);
    void (async () => {
      try {
        const result = await redeemPromoCode(token, trimmed);
        setCode('');
        setLine({ text: `Code applied: ${result.discountPct}% off.`, tone: 'success' });
        successHaptic();
        onRedeemed();
      } catch (err) {
        setLine({ text: promoErrorLine(toApiError(err).code), tone: 'error' });
        warnHaptic();
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <View style={styles.promoCard}>
      <AppText variant="label">Have a promo code?</AppText>
      <View style={styles.promoRow}>
        <AppTextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="e.g. GREECE30"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          editable={!busy}
          accessibilityLabel="Promo code"
          style={styles.promoInput}
        />
        <Button
          label={busy ? 'Applying…' : 'Apply'}
          loading={busy}
          disabled={busy || code.trim().length === 0}
          onPress={submit}
          variant="secondary"
          style={styles.promoBtn}
        />
      </View>
      {line ? (
        <AppText
          variant="caption"
          color={
            line.tone === 'error'
              ? colors.error
              : line.tone === 'success'
                ? colors.success
                : colors.textDim
          }
        >
          {line.text}
        </AppText>
      ) : null}
    </View>
  );
}

// ── Manual payment (receipt review) ───────────────────────────────

const PAYABLE_TIERS: PayableTier[] = ['silver', 'gold', 'elite'];
const MONTH_OPTIONS: (1 | 3 | 12)[] = [1, 3, 12];

/** "1 month" / "3 months" — one wording for the duration chip and for the
 * plan line the member confirms above the Submit button. */
function monthsLabel(months: number): string {
  return months === 1 ? '1 month' : `${months} months`;
}
/** Every method the server accepts, with the label used wherever one is shown
 * (including history rows for a method no longer offered in this region). */
const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'esewa', label: 'eSewa' },
  { value: 'khalti', label: 'Khalti' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

/** A method the member may pick, with the wording used inside a sentence. */
interface PaymentMethodOption {
  value: PayeeRail;
  label: string;
  phrase: string;
}

/** Rails, by region, with a sentence-friendly name for each. */
const REGION_RAILS: Record<SubscriptionCatalog['region'], PaymentMethodOption[]> = {
  // eSewa and Khalti are Nepali wallets and would be dead ends anywhere else,
  // so everywhere else gets bank transfer. 'other' was dropped: it named no
  // destination, so it could never be paid.
  NP: [
    { value: 'esewa', label: 'eSewa', phrase: 'eSewa' },
    { value: 'khalti', label: 'Khalti', phrase: 'Khalti' },
    { value: 'bank', label: 'Bank transfer', phrase: 'bank transfer' },
  ],
  INTL: [{ value: 'bank', label: 'Bank transfer', phrase: 'bank transfer' }],
};

/**
 * What the member can actually pick: the region's rails, minus every rail the
 * operator has published no destination for. An empty list means the manual
 * payment form is not shown at all — the screen says so instead of asking for a
 * transfer to nobody.
 */
function payableMethods(
  region: SubscriptionCatalog['region'] | null,
  payee: Payee | null,
): PaymentMethodOption[] {
  if (!region || !payee) return [];
  return REGION_RAILS[region].filter((m) => supportsRail(payee, m.value));
}

function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_OPTIONS.find((m) => m.value === method)?.label ?? method;
}

function receiptFileName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName) return asset.fileName;
  const ext = /\.(\w{2,4})$/.exec(asset.uri)?.[1];
  return `receipt.${ext ?? 'jpg'}`;
}

function paymentErrorLine(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again to continue.';
    case 'invalid':
      return 'Check your membership, duration and receipt, then try again.';
    case 'forbidden':
      return "You don't have permission to do that.";
    case 'image_not_configured':
      return 'Receipt uploads are temporarily unavailable.';
    case 'already_pending':
      return 'Your current payment is still awaiting review.';
    case 'receipt_already_used':
      return 'That receipt has already been submitted.';
    default:
      return "Your payment couldn't be sent. Check your connection and try again.";
  }
}

function paymentStatusTone(status: PaymentRequestRow['status']): string {
  if (status === 'approved') return colors.success;
  if (status === 'rejected') return colors.error;
  // Refunded isn't a failure the member caused — the money went back. Keep it
  // neutral (quiet ink) rather than alarm-red, but clearly not a live benefit.
  if (status === 'refunded') return colors.textDim;
  return colors.warning;
}

function paymentStatusLabel(status: PaymentRequestRow['status']): string {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'refunded') return 'Refunded';
  return 'Pending review';
}

/** Short localized date for a payment-request row. */
function formatRequestDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Quiet status card for one manual payment request (tier · duration · money ·
 * status · date · any admin review note). */
function PaymentRequestCard({ request }: { request: PaymentRequestRow }) {
  const date = formatRequestDate(request.createdAt);
  return (
    <View style={styles.pendingCard}>
      <View style={styles.pendingHeader}>
        <AppText variant="bodyBold">
          {tierName(request.tier)} · {request.months}mo
        </AppText>
        <Tag
          label={paymentStatusLabel(request.status)}
          variant="outline"
          color={paymentStatusTone(request.status)}
        />
      </View>
      <AppText variant="caption" color={colors.textDim}>
        {formatMoney(request.amountMinor, request.currency)} via {paymentMethodLabel(request.method)}
        {date ? ` · ${date}` : ''}
      </AppText>
      {request.reviewNote ? (
        <AppText variant="caption" color={colors.textDim}>
          {request.reviewNote}
        </AppText>
      ) : request.status === 'refunded' ? (
        // A refund with no admin reason still needs to say what happened,
        // otherwise the row reads as a payment that just stopped counting.
        <AppText variant="caption" color={colors.textDim}>
          This payment was refunded and the membership it paid for was removed.
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Manual-payment history/receipts list (Pack J) — the account's submitted
 * eSewa/Khalti/bank requests, newest first (the server already orders them),
 * each with its amount, review status, date and any admin note. The latest
 * pending request doubles as the "under review" status card.
 */
function PaymentHistory({ requests }: { requests: PaymentRequestRow[] }) {
  return (
    <View style={styles.historyWrap}>
      <AppText variant="label">Payment history</AppText>
      {requests.map((request) => (
        <PaymentRequestCard key={request.id} request={request} />
      ))}
    </View>
  );
}

function ManualPaymentSection({
  token,
  catalog,
  payee,
  methods,
  tier,
  onTierChange,
  onSubmitted,
}: {
  token: string;
  catalog: SubscriptionCatalog;
  /** Never rendered without one — the parent hides this form when it is null. */
  payee: Payee;
  /** Non-empty: only rails with a published destination reach this form. */
  methods: PaymentMethodOption[];
  /** The plan being paid for. Owned by the screen so a "Choose" tap on a tier
   * card and this form can never point at two different memberships. */
  tier: PayableTier;
  onTierChange: (tier: PayableTier) => void;
  onSubmitted: () => void;
}) {
  const [months, setMonths] = useState<1 | 3 | 12>(1);
  const [method, setMethod] = useState<PayeeRail>(() => methods[0]?.value ?? 'bank');
  const [note, setNote] = useState('');
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: 'dim' | 'error' | 'success' } | null>(
    null,
  );

  // Only plans this region actually publishes a price for can be paid for
  // here: without a catalog entry the total below would read as nothing while
  // the server charged the real amount. Same derive-don't-store rule as
  // `activeMethod` below, so a catalog refresh can never strand the form on a
  // plan it can no longer price.
  const payableTiers = PAYABLE_TIERS.filter((t) => catalog.tiers.some((c) => c.tier === t));
  const activeTier: PayableTier = payableTiers.includes(tier) ? tier : (payableTiers[0] ?? tier);
  const catalogTier = catalog.tiers.find((t) => t.tier === activeTier);
  const unitMinor = catalogTier ? (catalogTier.discountedMinor ?? catalogTier.amountMinor) : 0;
  const totalMinor = unitMinor * months;
  const totalLabel = formatMoney(totalMinor, catalog.currency);
  const planLine = `${tierName(activeTier)} · ${monthsLabel(months)}`;

  // A catalog refresh can move the account between regions (the server persists
  // the country it resolves), and an operator can retire a wallet at any time.
  // Deriving the live choice rather than storing it means a Nepali wallet can
  // never stay selected on an international submission, and a rail whose
  // destination just disappeared can never be submitted — no effect, no stale
  // state, no invalid submit.
  const activeMethod: PayeeRail = methods.some((m) => m.value === method)
    ? method
    : (methods[0]?.value ?? 'bank');

  async function pick(): Promise<void> {
    setLine(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setLine({
        text: 'Allow photo library access in Settings to attach a receipt.',
        tone: 'dim',
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled) return;
    const picked = result.assets[0];
    if (picked) setAsset(picked);
  }

  function submit(): void {
    if (!asset || submitting) return;
    setSubmitting(true);
    setLine(null);
    void (async () => {
      try {
        const reservation = await reserveImageUpload(token, 'payment_receipt');
        await uploadImageAsset(reservation, {
          uri: asset.uri,
          name: receiptFileName(asset),
          type: asset.mimeType ?? 'image/jpeg',
        });
        await submitPaymentRequest(
          {
            // The plan on screen, always: `activeTier` is what the total, the
            // payee card and the button above were all computed from.
            tier: activeTier,
            months,
            method: activeMethod,
            receiptUrl: reservation.uid,
            ...(note.trim() ? { note: note.trim() } : {}),
            region: catalog.region,
          },
          token,
        );
        setAsset(null);
        setNote('');
        setLine({
          text: 'Payment submitted. An admin will review your receipt within 24 hours. We’ll notify you once it’s approved.',
          tone: 'success',
        });
        successHaptic();
        onSubmitted();
      } catch (err) {
        setLine({ text: paymentErrorLine(toApiError(err).code), tone: 'error' });
        warnHaptic();
      } finally {
        setSubmitting(false);
      }
    })();
  }

  return (
    <View style={styles.paymentPanel}>
      <AppText variant="label">Plan</AppText>
      <View style={styles.chipRow}>
        {payableTiers.map((t) => (
          <Chip
            key={t}
            label={tierName(t)}
            selected={activeTier === t}
            onPress={() => !submitting && onTierChange(t)}
          />
        ))}
      </View>

      <AppText variant="label">Duration</AppText>
      <View style={styles.chipRow}>
        {MONTH_OPTIONS.map((m) => (
          <Chip
            key={m}
            label={monthsLabel(m)}
            selected={months === m}
            onPress={() => !submitting && setMonths(m)}
          />
        ))}
      </View>

      <AppText variant="label">Pay with</AppText>
      <View style={styles.chipRow}>
        {methods.map((m) => (
          <Chip
            key={m.value}
            label={m.label}
            selected={activeMethod === m.value}
            onPress={() => !submitting && setMethod(m.value)}
          />
        ))}
      </View>

      {/* What is being bought and what it costs, in one block, right where the
          member is about to send money. The plan name used to live only in the
          chips above, so an amount could be read without ever seeing which
          membership it belonged to. */}
      <View style={styles.totalRow}>
        <View style={styles.totalMain}>
          <AppText variant="caption" color={colors.textDim}>
            Total due
          </AppText>
          <AppText variant="bodyBold">{planLine}</AppText>
        </View>
        <AppText variant="title">{totalLabel}</AppText>
      </View>

      {/* The destination, directly above the receipt step that asks the member
          to prove they sent it. */}
      <PayeeDetailsCard payee={payee} rails={[activeMethod]} amountLabel={totalLabel} />

      <AppTextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional)"
        maxLength={300}
        editable={!submitting}
        accessibilityLabel="Payment note"
      />

      {asset ? (
        <View style={styles.receiptPreview}>
          <Image
            source={{ uri: asset.uri }}
            style={styles.receiptThumb}
            resizeMode="cover"
            accessibilityLabel="Selected receipt photo preview"
          />
          <View style={styles.fileRow}>
            <Ionicons name="receipt-outline" size={18} color={colors.textDim} />
            <AppText
              variant="caption"
              color={colors.textDim}
              numberOfLines={1}
              style={styles.fileName}
            >
              {receiptFileName(asset)}
            </AppText>
          </View>
        </View>
      ) : null}

      <Button
        label={asset ? 'Change receipt photo' : 'Attach receipt photo'}
        variant="secondary"
        disabled={submitting}
        onPress={() => void pick()}
      />

      {line ? (
        <AppText
          variant="caption"
          color={
            line.tone === 'error'
              ? colors.error
              : line.tone === 'success'
                ? colors.success
                : colors.textDim
          }
        >
          {line.text}
        </AppText>
      ) : null}

      <Button
        label={
          submitting
            ? 'Submitting…'
            : totalMinor > 0
              ? `Submit payment · ${totalLabel}`
              : 'Submit payment'
        }
        accessibilityLabel={
          submitting ? 'Submitting your payment' : `Submit payment of ${totalLabel} for ${planLine}`
        }
        loading={submitting}
        disabled={submitting || !asset}
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Screen already supplies 16px of top air — no extra paddingTop here.
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  banner: { marginTop: spacing.xl },
  pitchWrap: { marginTop: spacing.lg },
  pricingNote: { marginTop: spacing.md },
  previewNote: { marginTop: spacing.sm, color: colors.success },
  planErrorNote: { marginTop: spacing.sm, color: colors.error },

  // Promo code entry — borderless charcoal block (block language).
  promoWrap: { marginTop: spacing.xl },
  promoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  promoRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  promoInput: { flex: 1 },
  promoBtn: { paddingHorizontal: spacing.lg },

  // Premium metal tier cards (components/TierCard) — stacked with block gaps.
  cards: { gap: spacing.md, marginTop: spacing.xl },

  // "You can't buy this here right now" notice — rides at the top of the card
  // stack (so it inherits the stack's spacing) in the quiet banner language.
  planNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  planNoticeText: { flex: 1 },

  activeTrialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  // Expiry / renew banner — quiet warning block; error-toned once lapsed.
  expiryBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  expiryBannerExpired: { backgroundColor: colors.surface },
  expiryText: { flex: 1 },

  // Manual-payment section — borderless charcoal block.
  paymentWrap: { marginTop: spacing.md },
  paymentPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  totalMain: { flex: 1, gap: 2 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fileName: { flex: 1 },
  receiptPreview: { gap: spacing.sm },
  receiptThumb: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  historyWrap: { gap: spacing.sm, marginTop: spacing.md },
  pendingCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
