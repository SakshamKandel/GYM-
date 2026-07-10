import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Tier } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  HeroCard,
  PressableScale,
  Screen,
  ScreenHeader,
  Tag,
  enterFade,
  enterUp,
} from '../../components/ui';
import { successHaptic, warnHaptic } from '../../lib/haptics';
import { syncProfileNow } from '../../lib/profileSync';
import { applyServerUser, useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { activateTrial } from '../buddy/actions';
import { trialErrorLine, TRIAL_TIERS } from '../buddy/logic';
import { useBuddyStore } from '../buddy/store';
import {
  getTrialStatus,
  setSubscriptionTier,
  type Trial,
  type TrialTier,
} from '../../lib/api/client';
import {
  formatNprAmount,
  GM_TIERS,
  RECOMMENDED_TIER,
  type GmTier,
} from './logic';
import { TierDetailSheet, type TierDetail } from './TierDetailSheet';

const EASE_OUT = Easing.bezier(0.25, 0.8, 0.4, 1);

/**
 * The GM Method paywall in the color-block language (REVAMP-BRIEF): huge
 * Oswald header, one charcoal pitch block with the mascot, then the tiers as
 * borderless color blocks. The recommended tier is THE screen's red hero —
 * black ink, black pill CTA — everything else stays charcoal. Nothing golden,
 * ever.
 *
 * Until store billing ships, choosing a plan applies the tier locally so
 * every gated screen can be previewed.
 */

export function SubscribeScreen() {
  const currentTier = useProfile((s) => s.tier);
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

  useEffect(() => {
    void fetchTrials();
  }, [fetchTrials]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function choose(tier: Tier): void {
    // TODO: RevenueCat purchase flow — until then the pick applies locally
    // as a preview so the whole app can be exercised on any tier.
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
      } catch {
        // Roll back the optimistic write — but never clobber a NEWER pick
        // (rapid re-taps) or another account's state (signed out mid-flight).
        if (useAuth.getState().token !== token) return;
        if (useProfile.getState().tier === tier) {
          update({ tier: previousTier });
          syncProfileNow();
        }
        setPreviewActive(false);
        setPlanError("Couldn't update your plan on the server — check your connection and try again.");
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

  /** Open the tap-to-reveal detail sheet with this tier's resolved perks and
   * its current trial status (computed here so the sheet stays buddy-free). */
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
    });
  }

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

      <View style={styles.cards}>
        {GM_TIERS.map((t, i) => (
          <TierCard
            key={t.tier}
            gmTier={t}
            index={i}
            currentTier={currentTier}
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

function TierCard({
  gmTier,
  index,
  currentTier,
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
  const isFree = gmTier.pricePerMonthNpr <= 0;
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
        {isFree ? (
          <AppText style={styles.priceNumber} color={ink} numberOfLines={1}>
            Free
          </AppText>
        ) : (
          <>
            <AppText variant="caption" color={inkDim} style={dim}>
              NPR
            </AppText>
            <AppText
              style={styles.priceNumber}
              color={ink}
              tabular
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatNprAmount(gmTier.pricePerMonthNpr)}
            </AppText>
            <AppText variant="caption" color={inkDim} style={dim}>
              /mo
            </AppText>
          </>
        )}
      </View>
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
          {canTrial && signedIn ? (
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
});
