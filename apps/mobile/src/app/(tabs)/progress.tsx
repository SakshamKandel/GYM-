import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { hasEntitlement, minTierFor } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Chip,
  enterDown,
  enterFade,
  FLOATING_TAB_SPACE,
  FractionStat,
  ProgressBar,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  UpgradePrompt,
} from '../../components/ui';
import { Big4Card } from '../../features/analytics/components/Big4Card';
import { MuscleBalanceSection } from '../../features/analytics/components/MuscleBalanceSection';
import { NutritionSection } from '../../features/analytics/components/NutritionSection';
import { OverviewSection } from '../../features/analytics/components/OverviewSection';
import { useAnalytics } from '../../features/analytics/hooks';
import { MeasurementsSection } from '../../features/body/components/MeasurementsSection';
import { StrengthSection } from '../../features/body/components/StrengthSection';
import { WeightSection } from '../../features/body/components/WeightSection';
import { todayIso } from '../../lib/dates';
import { useEffectiveTier } from '../../lib/tier';
import { useProfile } from '../../state/profile';

/**
 * Progress — the analytics dashboard: consistency + tonnage overview, muscle
 * balance (Gold), strength with the big-four card, weight & measurements, and
 * nutrition trends (Silver), all behind one chips row.
 *
 * Revamp layout (REVAMP-BRIEF): ScreenHeader (eyebrow → huge Oswald title →
 * meta chips) → red hero block (monthly-pace FractionStat + bar, the screen's
 * single red block) → pill section selector → sections unchanged.
 */

type Section = 'overview' | 'muscle' | 'strength' | 'weight' | 'nutrition';

const SECTIONS: readonly { key: Section; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'muscle', label: 'Muscle' },
  { key: 'strength', label: 'Strength' },
  { key: 'weight', label: 'Weight' },
  { key: 'nutrition', label: 'Nutrition' },
];

const styles = StyleSheet.create({
  metaChip: {
    minHeight: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The screen's one red block: monthly pace, black ink (brief §2, §11b).
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  heroCopy: { opacity: 0.85 },
  // Chips bleed to the screen edge so the pill row scrolls edge-to-edge.
  chips: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.gutter },
  chipsWrap: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginHorizontal: -spacing.gutter,
  },
  error: { marginTop: spacing.lg },
  skeletons: { marginTop: spacing.xl, gap: spacing.md },
});

/** Outlined meta pill under the title (brief §6 — chips may carry borders). */
function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <AppText variant="label" color={colors.text} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * Static placeholders (no shimmer — design law) roughly shaped like a section:
 * a micro-label line, a chart card, another label, a stat band.
 */
function SectionSkeleton() {
  return (
    <View style={styles.skeletons}>
      <Skeleton width={120} height={12} />
      <Skeleton height={150} radius={radius.lg} />
      <Skeleton width={160} height={12} />
      <Skeleton height={88} radius={radius.lg} />
    </View>
  );
}

export default function ProgressScreen() {
  const [section, setSection] = useState<Section>('overview');
  const tier = useEffectiveTier();
  const unitPref = useProfile((s) => s.unitPref);
  const daysPerWeek = useProfile((s) => s.daysPerWeek);
  const analytics = useAnalytics();
  const data = analytics.status === 'ready' ? analytics.data : null;

  const muscleUnlocked = hasEntitlement({ tier }, 'adaptive_progression');
  const nutritionUnlocked = hasEntitlement({ tier }, 'full_kcal_tracker');
  const loading = analytics.status === 'loading';

  // Cheap dynamic subtitle: finished sessions this calendar month, already in
  // the overview's 12-week window. Falls back to a static tagline pre-data.
  const monthPrefix = todayIso().slice(0, 7);
  const sessionsThisMonth = data
    ? data.overview.workoutDates.filter((d) => d.startsWith(monthPrefix)).length
    : 0;
  const heroSubtitle =
    sessionsThisMonth > 0
      ? 'Your consistency, strength, body data and nutrition in one place.'
      : 'Log your next session to start building your training story.';
  const sessionLabel = sessionsThisMonth === 1 ? 'SESSION' : 'SESSIONS';

  // Display-only pace target: the profile's days/week over a four-week month.
  const monthlyTarget = Math.max(1, daysPerWeek * 4);

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <ScreenHeader
        eyebrow="Progress center"
        title="Progress"
        meta={
          <>
            <MetaChip label="12 weeks" />
            <MetaChip label={`This month · ${sessionsThisMonth} ${sessionLabel}`} />
          </>
        }
      />

      <Animated.View entering={enterDown(1)} style={styles.hero}>
        <FractionStat
          label="Monthly pace"
          value={sessionsThisMonth}
          total={monthlyTarget}
          onBlock
        />
        <ProgressBar
          value={sessionsThisMonth / monthlyTarget}
          trackColor="rgba(0,0,0,0.15)" // sanctioned: bar track on a red block
          fillColor={colors.onBlock}
          accessibilityLabel={`Monthly pace: ${sessionsThisMonth} of ${monthlyTarget} sessions`}
        />
        <AppText variant="body" color={colors.onBlock} style={styles.heroCopy}>
          {heroSubtitle}
        </AppText>
      </Animated.View>

      <Animated.View entering={enterDown(2)} style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            {SECTIONS.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                selected={section === s.key}
                onPress={() => setSection(s.key)}
              />
            ))}
          </View>
        </ScrollView>
      </Animated.View>

      {analytics.status === 'error' ? (
        <AppText variant="body" style={styles.error}>
          {"Couldn't load your stats — pull to refresh or try again in a moment."}
        </AppText>
      ) : null}

      {/* Keyed wrappers so chip switches cross-fade instead of popping. */}
      {section === 'overview' ? (
        <Animated.View key="overview" entering={enterFade(0)}>
          {data ? <OverviewSection data={data.overview} /> : loading ? <SectionSkeleton /> : null}
        </Animated.View>
      ) : null}

      {section === 'muscle' ? (
        <Animated.View key="muscle" entering={enterFade(0)}>
          {!muscleUnlocked ? (
            // Locked teaser: title + lock only — never fake data.
            <View>
              <SectionLabel>Muscle balance</SectionLabel>
              <UpgradePrompt
                title="Muscle balance"
                description="Weekly hard sets per muscle against the 10–20 band, push-pull balance, and the muscles you haven't hit yet."
                requiredTier={minTierFor('adaptive_progression')}
              />
            </View>
          ) : data?.muscle ? (
            <MuscleBalanceSection data={data.muscle} />
          ) : loading ? (
            <SectionSkeleton />
          ) : null}
        </Animated.View>
      ) : null}

      {section === 'strength' ? (
        <Animated.View key="strength" entering={enterFade(0)}>
          {data ? (
            <Big4Card rows={data.big4} unitPref={unitPref} />
          ) : loading ? (
            <SectionSkeleton />
          ) : null}
          <SectionLabel>Your lifts</SectionLabel>
          <StrengthSection />
        </Animated.View>
      ) : null}

      {section === 'weight' ? (
        <Animated.View key="weight" entering={enterFade(0)}>
          <WeightSection />
          <MeasurementsSection />
        </Animated.View>
      ) : null}

      {section === 'nutrition' ? (
        <Animated.View key="nutrition" entering={enterFade(0)}>
          {!nutritionUnlocked ? (
            // Locked teaser: title + lock only — never fake data.
            <View>
              <SectionLabel>Nutrition trends</SectionLabel>
              <UpgradePrompt
                title="Nutrition trends"
                description="Two weeks of calories against your target, protein hit rate and water — the bigger picture behind the Food tab."
                requiredTier={minTierFor('full_kcal_tracker')}
              />
            </View>
          ) : data?.nutrition ? (
            <NutritionSection data={data.nutrition} />
          ) : loading ? (
            <SectionSkeleton />
          ) : null}
        </Animated.View>
      ) : null}
    </Screen>
  );
}
