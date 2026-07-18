import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, IconChip, PressableScale, Tag } from '../../../components/ui';
import type { GymCard as GymCardData } from '../api';
import { pushPath } from '../nav';

/**
 * One gym in the discovery list — a charcoal row card mirroring CoachCard's
 * block language: 64dp photo (or a placeholder chip when the operator hasn't
 * uploaded one yet), name + category tag, city + distance, and a rating pill
 * when we have our own reviews for it.
 */

const PHOTO = 64;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 88,
  },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radius.md },
  main: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nameText: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rail: { flexShrink: 0, alignItems: 'flex-end', gap: spacing.xs },
});

function categoryLabel(category: string): string {
  return category.replace('_', ' ');
}

export function GymCard({ gym }: { gym: GymCardData }) {
  const photoUrl = gym.photos[0]?.deliveryUrl;
  const metaBits = [gym.city || null, gym.distanceKm !== null ? `${gym.distanceKm.toFixed(1)} km away` : null].filter(
    (v): v is string => v !== null,
  );

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${gym.name}, ${categoryLabel(gym.category)}${
        gym.city ? `, ${gym.city}` : ''
      }. View details`}
      onPress={() => pushPath(`/gyms/${gym.slug}`)}
      style={styles.row}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.photo} accessibilityIgnoresInvertColors />
      ) : (
        <IconChip icon="business" size={PHOTO} />
      )}

      <View style={styles.main}>
        <View style={styles.nameRow}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.nameText}>
            {gym.name}
          </AppText>
          <Tag label={categoryLabel(gym.category)} variant="dim" />
        </View>
        {metaBits.length > 0 ? (
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {metaBits.join(' · ')}
          </AppText>
        ) : null}
      </View>

      <View style={styles.rail}>
        {gym.rating !== null ? (
          <View style={styles.metaRow}>
            <Ionicons name="star" size={14} color={colors.accent} />
            <AppText variant="label">{gym.rating.toFixed(1)}</AppText>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
      </View>
    </PressableScale>
  );
}
