import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { hasEntitlement, minTierFor } from '@gym/shared';
import { spacing } from '@gym/ui-tokens';
import {
  AppText,
  Chip,
  enterDown,
  enterFade,
  FLOATING_TAB_SPACE,
  Screen,
  SectionLabel,
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
import { useProfile } from '../../state/profile';

/**
 * Progress — the analytics dashboard: consistency + tonnage overview, muscle
 * balance (Gold), strength with the big-four card, weight & measurements, and
 * nutrition trends (Silver), all behind one chips row.
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
  chips: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.lg },
  chipsWrap: { marginTop: spacing.lg, marginBottom: spacing.sm },
});

export default function ProgressScreen() {
  const [section, setSection] = useState<Section>('overview');
  const tier = useProfile((s) => s.tier);
  const unitPref = useProfile((s) => s.unitPref);
  const data = useAnalytics();

  const muscleUnlocked = hasEntitlement({ tier }, 'adaptive_progression');
  const nutritionUnlocked = hasEntitlement({ tier }, 'full_kcal_tracker');

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterDown(0)}>
        <AppText variant="heading">Progress</AppText>
      </Animated.View>

      <Animated.View entering={enterDown(1)} style={styles.chipsWrap}>
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

      {/* Keyed wrappers so chip switches cross-fade instead of popping. */}
      {section === 'overview' ? (
        <Animated.View key="overview" entering={enterFade(0)}>
          {data ? <OverviewSection data={data.overview} /> : null}
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
          ) : null}
        </Animated.View>
      ) : null}

      {section === 'strength' ? (
        <Animated.View key="strength" entering={enterFade(0)}>
          {data ? <Big4Card rows={data.big4} unitPref={unitPref} /> : null}
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
          ) : null}
        </Animated.View>
      ) : null}
    </Screen>
  );
}
