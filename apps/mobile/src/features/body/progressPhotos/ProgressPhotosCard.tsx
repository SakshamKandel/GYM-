import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement, minTierFor } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { StyleSheet, View } from 'react-native';
import {
  AppText,
  Button,
  Card,
  SectionLabel,
  UpgradePrompt,
} from '../../../components/ui';
import { useEffectiveTier } from '../../../lib/tier';

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  icon: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { gap: spacing.xs },
});

/** Discoverable Progress-tab entry for the private photo timeline. */
export function ProgressPhotosCard() {
  const tier = useEffectiveTier();
  const unlocked = hasEntitlement({ tier }, 'progress_photos');

  return (
    <View>
      <SectionLabel>Progress photos</SectionLabel>
      {unlocked ? (
        <Card style={styles.card}>
          <View style={styles.icon}>
            <Ionicons name="images-outline" size={24} color={colors.accent} />
          </View>
          <View style={styles.copy}>
            <AppText variant="title">See the change over time</AppText>
            <AppText variant="body" color={colors.textDim}>
              Keep dated photos in a private gallery that only you can open.
            </AppText>
          </View>
          <Button
            label="Open private gallery"
            variant="secondary"
            accessibilityLabel="Open your private progress photo gallery"
            onPress={() => router.push('/body/photos' as Href)}
          />
        </Card>
      ) : (
        <UpgradePrompt
          title="Private progress photos"
          description="Build a dated, private visual timeline alongside your weight and measurements."
          requiredTier={minTierFor('progress_photos')}
        />
      )}
    </View>
  );
}
