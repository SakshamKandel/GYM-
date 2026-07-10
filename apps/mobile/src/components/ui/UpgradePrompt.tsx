import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Tier } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Shown in place of a tier-gated feature. Sells the GM Method without
 * shaming: what the feature does + which plan unlocks it.
 */
interface Props {
  title: string;
  description: string;
  requiredTier: Tier;
}

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const styles = StyleSheet.create({
  // Borderless charcoal card — separation by fill contrast (REVAMP-BRIEF §1).
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
});

export function UpgradePrompt({ title, description, requiredTier }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Ionicons name="lock-closed" size={13} color={colors.accent} />
          <AppText variant="label" color={colors.text}>
            {TIER_LABEL[requiredTier]} plan
          </AppText>
        </View>
      </View>
      <AppText variant="title">{title}</AppText>
      <AppText variant="caption">{description}</AppText>
      <Button
        label="See GM Method plans"
        variant="secondary"
        // typed-routes catches up once the /subscribe route file is generated
        onPress={() => router.push('/subscribe' as Href)}
      />
    </View>
  );
}
