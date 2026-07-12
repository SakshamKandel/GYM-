import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { compareTiers, formatMoney, type Tier } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  HeroCard,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Tag,
  enterFade,
  enterUp,
} from '../../components/ui';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { syncProfileNow } from '../../lib/profileSync';
import { useEffectiveTier } from '../../lib/tier';
import { applyServerUser, useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { activateTrial } from '../buddy/actions';
import { trialErrorLine, TRIAL_TIERS } from '../buddy/logic';
import { useBuddyStore } from '../buddy/store';
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
import { GM_TIERS, RECOMMENDED_TIER, regionHint, tierPriceDisplay, type GmTier } from './logic';
import { TierDetailSheet, type TierDetail } from './TierDetailSheet';

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

/**
 * The GM Method paywall in the color-block language (REVAMP-BRIEF): huge
 * Oswald header, one charcoal pitch block with the mascot, then the tiers as
 * borderless color blocks. The recommended tier is THE screen's red hero —
 * black ink, black pill CTA — everything else stays charcoal. Nothing golden,
 * ever.
 *
 * Pricing (SCALE-UP-PLAN §1.1/§4.1/§5.1): live regional prices + any active
 * discount come from GET /api/subscription/catalog while signed in; signed
 * out (or offline) falls back to the shared DEFAULT_TIER_PRICES constant
 * resolved against a device locale hint. GM_TIERS keeps its feature copy —
 * price is no longer read from it.
 *
 * A promo code can be redeemed inline (refetches the catalog on success).
 * Nepal-region accounts additionally see a manual eSewa/Khalti/bank payment
 * flow: pick a plan + duration, attach a receipt photo, submit for admin
 * review — the amount is always computed server-side from the live catalog.
 *
 * Until store billing ships, choosing a plan applies the tier locally so
 * every gated screen can be previewed.
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
  const [detail, setDetail] = useState<TierDetail | null>(null);
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);

  const [catalog, setCatalog] = useState<SubscriptionCatalog | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestRow[]>([]);

  const fetchTrials = useCallback(async () => {
    if (status !== 'signedIn' || !token) return;
    try {
      const result = await getTrialStatus(token);
      setTrials(result.trials);
      setTrialDays(result.trialDays);
      useBuddyStore.getState().setTrials(result.trials, result.trialDays);
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
      // Keep the last-known catalog — tier cards fall back to the shared
      // DEFAULT_TIER_PRICES constant when there's nothing loaded yet.
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
    // Store purchase flow (RevenueCat) is pending store accounts. Until then
    // the pick applies locally as a preview so the whole app can be exercised
    // on any tier. When the server runs BILLING_MODE=live it answers paid
    // picks with 'billing_required' — handled below with a specific message —
    // so a live backend can never be talked into a free paid tier.
    const previousTier = useProfile.getState().tier;
    // Optimistic local apply for instant UI; the profile blob backup keeps
    // preferences in sync (the server ignores its tier field — the account
    // tier is only ever written through POST /api/subscription/tier below).
    update({ tier });
    syncProfileNow();
    setPreviewActive(true);
    setPlanError(null);
    successHaptic();

    // Signed out → local-only preview, exactly as before.
    if (status !== 'signedIn' || !token) return;

    // Signed in → the server is the tier authority. Persist the choice and
    // adopt the returned user so everything reading useAuth's tier (home
    // tier ring, server-gated screens) updates now — not on the next app
    // foreground, and never "until reload" on web.
    void (async () => {
      try {
        const user = await setSubscriptionTier(token, tier);
        applyServerUser(user, token);
      } catch (err) {
        // Roll back the optimistic write — but never clobber a NEWER pick
        // (rapid re-taps) or another account's state (signed out mid-flight).
        if (useAuth.getState().token !== token) return;
        if (useProfile.getState().tier === tier) {
          update({ tier: previousTier });
          syncProfileNow();
        }
        setPreviewActive(false);
        setPlanError(
          toApiError(err).code === 'billing_required'
            ? 'Paid plans are activated through the app store purchase — the free preview is closed on this server.'
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
   * catalog/buddy-free). */
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

  const latestPaymentRequest = paymentRequests[0] ?? null;

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

      <Animated.View entering={enterUp(0)} style={styles.pitchWrap}>
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
          </AppText>
          {latestPaymentRequest ? (
            <PendingPaymentRow request={latestPaymentRequest} />
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

/** Text-only trial affordance for INSIDE the red hero block — mirrors
 * `Button variant="ghost"` (metrics, a11y, loading/disabled states) but with
 * black ink, because white-on-red is banned by the block language. */
function OnRedGhostButton({
  label,
  disabled,
  loading,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.onRedGhost, (disabled || loading) && styles.onRedGhostDisabled]}
    >
      {loading ? <ActivityIndicator color={colors.onBlock} /> : null}
      <AppText
        style={styles.onRedGhostLabel}
        tabular={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </AppText>
    </PressableScale>
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

/** Quiet status card for the most recent manual payment request. */
function PendingPaymentRow({ request }: { request: PaymentRequestRow }) {
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
      </AppText>
      {request.reviewNote ? (
        <AppText variant="caption" color={colors.textDim}>
          {request.reviewNote}
        </AppText>
      ) : null}
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
          text: 'Payment submitted — an admin will review your receipt shortly.',
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
        <View style={styles.fileRow}>
          <Ionicons name="receipt-outline" size={18} color={colors.textDim} />
          <AppText variant="caption" color={colors.textDim} numberOfLines={1} style={styles.fileName}>
            {receiptFileName(asset)}
          </AppText>
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

// ── Tier card ──────────────────────────────────────────────────────

function TierCard({
  gmTier,
  index,
  currentTier,
  catalog,
  onChoose,
  trialDays,
  trialed,
  isTrialActive,
  trialing,
  onTrial,
  onOpenDetail,
  signedIn,
}: {
  gmTier: GmTier;
  index: number;
  currentTier: Tier;
  catalog: SubscriptionCatalog | null;
  onChoose: (tier: Tier) => void;
  trialDays: number;
  trialed: boolean;
  isTrialActive: boolean;
  trialing: string | null;
  onTrial: (tier: TrialTier) => Promise<void>;
  onOpenDetail: (tier: GmTier) => void;
  signedIn: boolean;
}) {
  const isCurrent = gmTier.tier === currentTier;
  const isRecommended = gmTier.tier === RECOMMENDED_TIER;
  const price = tierPriceDisplay(gmTier.tier, catalog);
  const previous = index > 0 ? GM_TIERS[index - 1] : undefined;
  const canTrial = TRIAL_TIERS.includes(gmTier.tier as TrialTier);

  // Block ink: the recommended card is the screen's ONE red hero block —
  // everything on it is black (`onBlock`); dim text dims via opacity, which
  // keeps ≥4.5:1 on the red fill at 0.8.
  const onRed = isRecommended;
  const ink = onRed ? colors.onBlock : colors.text;
  const inkDim = onRed ? colors.onBlock : colors.textDim;
  const dim = onRed ? styles.redDim : undefined;

  // Selection wash: a quiet accent tint fades in when this becomes the current
  // plan (a user-driven state change — motion is allowed). Reduced-motion snaps.
  const reduceMotion = useReducedMotion();
  const selected = useSharedValue(isCurrent ? 1 : 0);
  useEffect(() => {
    selected.value = reduceMotion
      ? isCurrent
        ? 1
        : 0
      : withTiming(isCurrent ? 1 : 0, { duration: 260, easing: EASE_OUT });
  }, [isCurrent, reduceMotion, selected]);
  const washStyle = useAnimatedStyle(() => ({ opacity: selected.value * 0.7 }));

  const trialLabel = isTrialActive
    ? 'Trial active'
    : trialed
      ? 'Trial used'
      : `Try free for ${trialDays} days`;

  const discountLabel =
    price.discountPct !== null
      ? price.discountSource === 'referral'
        ? `Referral −${price.discountPct}%`
        : `Promo −${price.discountPct}%`
      : null;

  return (
    <Animated.View
      entering={enterUp(index + 1)}
      style={[styles.card, onRed && styles.cardRed]}
    >
      {/* The accent wash only reads on charcoal — the red hero marks "current"
          with its Current tag + hidden CTA instead. */}
      {onRed ? null : (
        <Animated.View pointerEvents="none" style={[styles.cardWash, washStyle]} />
      )}
      <View style={styles.nameRow}>
        <AppText variant="title" color={ink} style={styles.name} numberOfLines={1}>
          {gmTier.name}
        </AppText>
        <View style={styles.tags}>
          {isRecommended ? <Tag label="Most popular" variant="onBlock" /> : null}
          {isCurrent ? <Tag label="Current" variant={onRed ? 'onBlock' : 'dim'} /> : null}
        </View>
      </View>

      <View style={styles.priceRow}>
        {price.isFree ? (
          <AppText style={styles.priceNumber} color={ink} numberOfLines={1}>
            Free
          </AppText>
        ) : (
          <>
            {price.discountedMinor !== null ? (
              <AppText
                variant="caption"
                color={inkDim}
                style={[dim, styles.strike]}
                numberOfLines={1}
              >
                {formatMoney(price.baseMinor, price.currency)}
              </AppText>
            ) : null}
            <AppText
              style={styles.priceNumber}
              color={ink}
              tabular
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatMoney(price.discountedMinor ?? price.baseMinor, price.currency)}
            </AppText>
            <AppText variant="caption" color={inkDim} style={dim}>
              /mo
            </AppText>
          </>
        )}
      </View>
      {discountLabel ? (
        <View style={styles.discountTagRow}>
          <Tag label={discountLabel} variant={onRed ? 'onBlock' : 'dim'} />
        </View>
      ) : null}
      <AppText variant="caption" color={inkDim} style={dim}>
        {gmTier.tagline}
      </AppText>

      <View style={styles.features}>
        {previous ? (
          <AppText
            variant="caption"
            color={onRed ? colors.onBlock : colors.textFaint}
            style={dim}
          >
            Everything in {previous.name}, plus
          </AppText>
        ) : null}
        {gmTier.features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={onRed ? colors.onBlock : colors.textDim}
              style={styles.featureIcon}
            />
            <AppText color={ink} style={styles.featureText}>
              {feature}
            </AppText>
          </View>
        ))}
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`See everything included in ${gmTier.name}`}
        onPress={() => onOpenDetail(gmTier)}
        style={styles.detailLink}
      >
        <AppText variant="caption" color={inkDim} style={dim}>
          See everything included
        </AppText>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={inkDim}
          style={dim}
        />
      </PressableScale>

      {isCurrent ? null : (
        <View style={styles.btnStack}>
          <Button
            label={`Choose ${gmTier.name}`}
            variant={onRed ? 'onBlock' : 'secondary'}
            onPress={() => onChoose(gmTier.tier)}
          />
          {/* Trials only make sense on tiers ABOVE the current one — the
              server refuses the rest with 'not_an_upgrade'. */}
          {canTrial && signedIn && compareTiers(gmTier.tier, currentTier) > 0 ? (
            onRed ? (
              <OnRedGhostButton
                label={trialLabel}
                disabled={trialed || trialing !== null}
                loading={trialing === gmTier.tier}
                onPress={() => onTrial(gmTier.tier as TrialTier)}
              />
            ) : (
              <Button
                label={trialLabel}
                variant="ghost"
                disabled={trialed || trialing !== null}
                loading={trialing === gmTier.tier}
                onPress={() => onTrial(gmTier.tier as TrialTier)}
                style={styles.trialBtn}
              />
            )
          ) : null}
        </View>
      )}
    </Animated.View>
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

  pitchWrap: { marginTop: spacing.xl },
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

  // Tier blocks — borderless color blocks; the recommended tier is the
  // screen's single red hero, the rest stay charcoal.
  cards: { gap: spacing.md, marginTop: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.xs,
  },
  cardRed: { backgroundColor: colors.blockRed },
  // Quiet accent wash marking the current plan; sits behind the card content.
  // (absoluteFillObject spelled out — RN 0.86 types no longer export it.)
  cardWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.block,
    backgroundColor: colors.accentFaint,
  },
  // Dim ink on the red block: black at 0.8 keeps ≥4.5:1 over blockRed.
  redDim: { opacity: 0.8 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  name: { flexShrink: 1, minWidth: 0 },
  tags: { flexShrink: 0, flexDirection: 'row', gap: spacing.sm },

  // Price: big Oswald number + tiny dim currency/period captions.
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    marginTop: spacing.sm,
    minWidth: 0,
  },
  priceNumber: {
    fontFamily: type.display,
    fontSize: type.size.display,
    lineHeight: 46,
    letterSpacing: 0.5,
    flexShrink: 1,
    minWidth: 0,
  },
  strike: { textDecorationLine: 'line-through' },
  discountTagRow: { flexDirection: 'row', marginTop: spacing.xs },

  features: { marginTop: spacing.lg, gap: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  featureIcon: { marginTop: 3 },
  featureText: { flex: 1, lineHeight: 24 },

  // "See everything included" reveal affordance — gap instead of a hairline.
  detailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.min,
    marginTop: spacing.sm,
  },

  btnStack: { marginTop: spacing.sm, gap: spacing.xs },
  trialBtn: { minHeight: touch.min },

  // Ghost trial affordance inside the red hero (black ink, Button metrics).
  onRedGhost: {
    minHeight: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  onRedGhostDisabled: { opacity: 0.4 },
  onRedGhostLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: 16,
    letterSpacing: 0.3,
    color: colors.onBlock,
  },

  activeTrialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

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
