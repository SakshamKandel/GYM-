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
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { syncProfileNow } from '../../lib/profileSync';
import { useEffectiveTier } from '../../lib/tier';
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
 * Nepal-region accounts additionally see a manual eSewa/Khalti/bank payment
 * flow: pick a plan + duration, attach a receipt photo, submit for admin
 * review — the amount is always computed server-side from the live catalog.
 *
 * A paid tier is applied optimistically only when the server explicitly
 * advertises non-production preview mode; otherwise the real store/manual
 * payment path is required.
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
        'Cancel your plan?',
        keepsAccess
          ? `You'll keep your current benefits until ${info.dateLabel}, then move to the free plan. You won't be charged again.`
          : "You'll move to the free plan. You can re-subscribe any time.",
        [
          { text: 'Keep plan', style: 'cancel' },
          {
            text: 'Cancel plan',
            style: 'destructive',
            onPress: () => applyTierChange('starter'),
          },
        ],
      );
      return;
    }

    // Paid pick while the server runs LIVE billing → the self-serve endpoint
    // 402s every paid tier. Pre-detect it (B23): show the honest affordance
    // instead of optimistically applying then reverting on the rejection.
    if (status !== 'signedIn' || !token) {
      warnHaptic();
      setPlanError('Sign in to view live pricing and choose a plan.');
      return;
    }

    if (!catalog) {
      warnHaptic();
      setPlanError('Live pricing is unavailable. Check your connection and try again.');
      return;
    }

    if (catalog.billingMode !== 'preview') {
      warnHaptic();
      setPlanError(
        catalog.region === 'NP'
          ? 'Pay for this plan with eSewa or Khalti below, then upload your receipt for review.'
          : catalog.billingMode === 'live'
            ? 'This plan must be purchased through the app store.'
            : 'Purchases are temporarily unavailable on this server.',
      );
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
      setPlanError('Sign in to change your plan.');
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
              ? `Plan cancelled — you keep access until ${info.dateLabel}.`
              : 'Your plan has been cancelled.',
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
            ? 'Paid plan activation is unavailable here. Use the configured store or manual-payment flow.'
            : "Couldn't update your plan on the server — check your connection and try again.",
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
    ? `Your membership ended on ${expiry.dateLabel}. Choose a plan below to renew.`
    : `Your ${gmTierName(currentTier)} plan ends in ${expiry.daysLeft} ${
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
            Not generic macros — a method that adapts to your body every week.
          </AppText>
        </HeroCard>
        <AppText variant="caption" color={colors.textDim} style={styles.pricingNote}>
          {trialDays}-day free trial on every plan · monthly or discounted annual billing
        </AppText>
        {previewActive ? (
          <Animated.View entering={enterFade()}>
            <AppText variant="caption" style={styles.previewNote}>
              Payments launch with the app-store release — your plan is active
              for preview.
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
              {activeTrial.tier.charAt(0).toUpperCase() + activeTrial.tier.slice(1)} trial active until{' '}
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

      {status === 'signedIn' && token && catalog?.region === 'NP' ? (
        <Animated.View entering={enterUp(GM_TIERS.length + 1)} style={styles.paymentWrap}>
          <SectionLabel>Pay via eSewa / Khalti</SectionLabel>
          <AppText variant="caption" color={colors.textDim}>
            Pick a plan, pay outside the app, then upload your receipt for review.
            Reviews are usually completed within 24 hours.
          </AppText>
          {paymentRequests.length > 0 ? (
            <PaymentHistory requests={paymentRequests} />
          ) : null}
          <NepalPaymentSection
            token={token}
            catalog={catalog}
            onSubmitted={fetchPaymentRequests}
          />
        </Animated.View>
      ) : null}

      <TierDetailSheet detail={detail} onClose={() => setDetail(null)} />
    </Screen>
  );
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
      return 'Your session expired — sign in again to continue.';
    default:
      return "Couldn't reach the server — try again.";
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
        setLine({ text: `Code applied — ${result.discountPct}% off.`, tone: 'success' });
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

// ── Nepal manual payment (eSewa/Khalti/bank) ──────────────────────

const PAYABLE_TIERS: PayableTier[] = ['silver', 'gold', 'elite'];
const MONTH_OPTIONS: (1 | 3 | 12)[] = [1, 3, 12];
const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'esewa', label: 'eSewa' },
  { value: 'khalti', label: 'Khalti' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

function gmTierName(tier: Tier): string {
  return GM_TIERS.find((g) => g.tier === tier)?.name ?? tier;
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
      return 'Your session expired — sign in again to continue.';
    case 'invalid':
      return 'Check your plan, duration and receipt, then try again.';
    case 'forbidden':
      return "You don't have permission to do that.";
    case 'image_not_configured':
      return 'Receipt uploads are temporarily unavailable.';
    case 'already_pending':
      return 'Your current payment is still awaiting review.';
    case 'receipt_already_used':
      return 'That receipt has already been submitted.';
    default:
      return "Couldn't reach the server — check your connection and try again.";
  }
}

function paymentStatusTone(status: PaymentRequestRow['status']): string {
  if (status === 'approved') return colors.success;
  if (status === 'rejected') return colors.error;
  return colors.warning;
}

function paymentStatusLabel(status: PaymentRequestRow['status']): string {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
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
          {gmTierName(request.tier)} · {request.months}mo
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

function NepalPaymentSection({
  token,
  catalog,
  onSubmitted,
}: {
  token: string;
  catalog: SubscriptionCatalog;
  onSubmitted: () => void;
}) {
  const [tier, setTier] = useState<PayableTier>('silver');
  const [months, setMonths] = useState<1 | 3 | 12>(1);
  const [method, setMethod] = useState<PaymentMethod>('esewa');
  const [note, setNote] = useState('');
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: 'dim' | 'error' | 'success' } | null>(
    null,
  );

  const catalogTier = catalog.tiers.find((t) => t.tier === tier);
  const unitMinor = catalogTier ? (catalogTier.discountedMinor ?? catalogTier.amountMinor) : 0;
  const totalMinor = unitMinor * months;

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
            tier,
            months,
            method,
            receiptUrl: reservation.uid,
            ...(note.trim() ? { note: note.trim() } : {}),
            region: catalog.region,
          },
          token,
        );
        setAsset(null);
        setNote('');
        setLine({
          text: 'Payment submitted — an admin will review your receipt within 24 hours. We’ll notify you once it’s approved.',
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
        {PAYABLE_TIERS.map((t) => (
          <Chip
            key={t}
            label={gmTierName(t)}
            selected={tier === t}
            onPress={() => !submitting && setTier(t)}
          />
        ))}
      </View>

      <AppText variant="label">Duration</AppText>
      <View style={styles.chipRow}>
        {MONTH_OPTIONS.map((m) => (
          <Chip
            key={m}
            label={m === 1 ? '1 month' : `${m} months`}
            selected={months === m}
            onPress={() => !submitting && setMonths(m)}
          />
        ))}
      </View>

      <AppText variant="label">Pay with</AppText>
      <View style={styles.chipRow}>
        {PAYMENT_METHOD_OPTIONS.map((m) => (
          <Chip
            key={m.value}
            label={m.label}
            selected={method === m.value}
            onPress={() => !submitting && setMethod(m.value)}
          />
        ))}
      </View>

      <View style={styles.totalRow}>
        <AppText variant="caption" color={colors.textDim}>
          Total due
        </AppText>
        <AppText variant="title">{formatMoney(totalMinor, catalog.currency)}</AppText>
      </View>

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
        label={submitting ? 'Submitting…' : 'Submit payment'}
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

  // Nepal manual-payment section — borderless charcoal block.
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
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
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
