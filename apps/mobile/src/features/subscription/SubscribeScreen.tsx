import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Tier } from '@gym/shared';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  HeroCard,
  PressableScale,
  Screen,
  Tag,
  enterDown,
  enterFade,
  enterUp,
} from '../../components/ui';
import { successHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import { useProfile } from '../../state/profile';
import { activateTrial } from '../buddy/actions';
import { trialErrorLine, TRIAL_TIERS } from '../buddy/logic';
import { useBuddyStore } from '../buddy/store';
import { getTrialStatus, type Trial, type TrialTier } from '../../lib/api/client';
import {
  formatNprAmount,
  GM_TIERS,
  RECOMMENDED_TIER,
  type GmTier,
} from './logic';

/**
 * The GM Method paywall — THE sales moment, kept deliberately minimal.
 * One HeroCard poster, then the four tiers as airy hairline cards. The
 * recommended tier is marked only by an accent border + "Most popular"
 * tag and owns the single red primary button. Nothing golden, ever.
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
    update({ tier });
    setPreviewActive(true);
    successHaptic();
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

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <Animated.View entering={enterUp(0)}>
        <HeroCard mascot tone="surface">
          <AppText variant="label" color={colors.accent}>
            THE GM METHOD
          </AppText>
          <AppText variant="heading" style={styles.heroTitle}>
            Train the way Greece Maharjan grows
          </AppText>
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
            signedIn={status === 'signedIn'}
          />
        ))}
      </View>
    </Screen>
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
  signedIn: boolean;
}) {
  const isCurrent = gmTier.tier === currentTier;
  const isRecommended = gmTier.tier === RECOMMENDED_TIER;
  const isFree = gmTier.pricePerMonthNpr <= 0;
  const previous = index > 0 ? GM_TIERS[index - 1] : undefined;
  const canTrial = TRIAL_TIERS.includes(gmTier.tier as TrialTier);

  return (
    <Animated.View
      entering={enterUp(index + 1)}
      style={[styles.card, isRecommended && styles.cardRecommended]}
    >
      <View style={styles.nameRow}>
        <AppText variant="title" style={styles.name} numberOfLines={1}>
          {gmTier.name}
        </AppText>
        <View style={styles.tags}>
          {isRecommended ? <Tag label="Most popular" variant="filled" /> : null}
          {isCurrent ? <Tag label="Current" variant="dim" /> : null}
        </View>
      </View>

      <View style={styles.priceRow}>
        {isFree ? (
          <AppText style={styles.priceNumber} numberOfLines={1}>Free</AppText>
        ) : (
          <>
            <AppText variant="caption" color={colors.textDim}>
              NPR
            </AppText>
            <AppText
              style={styles.priceNumber}
              tabular
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatNprAmount(gmTier.pricePerMonthNpr)}
            </AppText>
            <AppText variant="caption" color={colors.textDim}>
              /mo
            </AppText>
          </>
        )}
      </View>
      <AppText variant="caption">{gmTier.tagline}</AppText>

      <View style={styles.features}>
        {previous ? (
          <AppText variant="caption" color={colors.textFaint}>
            Everything in {previous.name}, plus
          </AppText>
        ) : null}
        {gmTier.features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={colors.textDim}
              style={styles.featureIcon}
            />
            <AppText style={styles.featureText}>{feature}</AppText>
          </View>
        ))}
      </View>

      {isCurrent ? null : (
        <View style={styles.btnStack}>
          <Button
            label={`Choose ${gmTier.name}`}
            variant={isRecommended ? 'primary' : 'secondary'}
            onPress={() => onChoose(gmTier.tier)}
            style={styles.chooseBtn}
          />
          {canTrial && signedIn ? (
            <Button
              label={
                isTrialActive
                  ? 'Trial active'
                  : trialed
                    ? 'Trial used'
                    : `Try free for ${trialDays} days`
              }
              variant="ghost"
              disabled={trialed || trialing !== null}
              loading={trialing === gmTier.tier}
              onPress={() => onTrial(gmTier.tier as TrialTier)}
              style={styles.trialBtn}
            />
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Screen already supplies 16px of top air — no extra paddingTop here.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Poster hero — sized to wrap in ~2 lines beside the mascot art,
  // not one word per line.
  heroTitle: { fontSize: 25, lineHeight: 32 },
  pricingNote: { marginTop: spacing.md },
  previewNote: { marginTop: spacing.sm, color: colors.success },

  // Tier cards — hairline by default; only the recommended card gets accent.
  cards: { gap: spacing.lg, marginTop: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.xs,
  },
  cardRecommended: { borderWidth: 1.5, borderColor: colors.accent },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  name: { flexShrink: 1, minWidth: 0 },
  tags: { flexShrink: 0, flexDirection: 'row', gap: spacing.sm },

  // Price: Oswald number + tiny dim currency/period captions.
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    marginTop: spacing.sm,
    minWidth: 0,
  },
  priceNumber: {
    fontFamily: type.display,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: 0.5,
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },

  features: { marginTop: spacing.lg, gap: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  featureIcon: { marginTop: 3 },
  featureText: { flex: 1, lineHeight: 24 },

  btnStack: { marginTop: spacing.lg, gap: spacing.xs },
  chooseBtn: {},
  trialBtn: { minHeight: touch.min },

  activeTrialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
});
