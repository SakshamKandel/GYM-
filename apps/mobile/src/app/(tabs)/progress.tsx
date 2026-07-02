import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { spacing } from '@gym/ui-tokens';
import { AppText, Chip, enterDown, enterFade, FLOATING_TAB_SPACE, Screen } from '../../components/ui';
import { MeasurementsSection } from '../../features/body/components/MeasurementsSection';
import { StrengthSection } from '../../features/body/components/StrengthSection';
import { WeightSection } from '../../features/body/components/WeightSection';

/** Progress — weight trend, strength (e1RM), tape measurements. */

type Section = 'weight' | 'strength' | 'measurements';

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.lg },
  chipsWrap: { marginTop: spacing.lg, marginBottom: spacing.sm },
});

export default function ProgressScreen() {
  const [section, setSection] = useState<Section>('weight');

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterDown(0)}>
        <AppText variant="heading">Progress</AppText>
      </Animated.View>

      <Animated.View entering={enterDown(1)} style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            <Chip
              label="Weight"
              selected={section === 'weight'}
              onPress={() => setSection('weight')}
            />
            <Chip
              label="Strength"
              selected={section === 'strength'}
              onPress={() => setSection('strength')}
            />
            <Chip
              label="Measurements"
              selected={section === 'measurements'}
              onPress={() => setSection('measurements')}
            />
          </View>
        </ScrollView>
      </Animated.View>

      {/* Keyed wrappers so chip switches cross-fade instead of popping. */}
      {section === 'weight' ? (
        <Animated.View key="weight" entering={enterFade(0)}>
          <WeightSection />
        </Animated.View>
      ) : null}
      {section === 'strength' ? (
        <Animated.View key="strength" entering={enterFade(0)}>
          <StrengthSection />
        </Animated.View>
      ) : null}
      {section === 'measurements' ? (
        <Animated.View key="measurements" entering={enterFade(0)}>
          <MeasurementsSection />
        </Animated.View>
      ) : null}
    </Screen>
  );
}
