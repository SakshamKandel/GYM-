import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { GymPublicCard } from '@gym/shared';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, PressableScale, Tag } from '../../../components/ui';
import { pushPath } from '../nav';

/**
 * One gym in the discovery list — a photo-led cover card (brief §1). The first
 * uploaded photo fills the card under a bottom scrim (same treatment as the
 * shared PhotoCard); the name, category and city sit over the scrim, with a
 * distance chip and a "TOP RATED" badge floated on top. When the operator
 * hasn't uploaded a photo yet we fall back to a branded initial tile so the
 * row still reads as a real place, never a blank grey box.
 *
 * The list payload carries no hours or amenities (see features/gyms/api.ts) —
 * open-now and amenity chips live on the detail page where that data exists.
 */

const CARD_HEIGHT = 208;
const TOP_RATED_THRESHOLD = 4.5;

/** Transparent → near-black, bottom-anchored, matching PhotoCard's scrim. */
const SCRIM = ['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.82)'] as const;

function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ');
}

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    borderRadius: radius.block,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' },
  // Branded fallback when there's no photo.
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackInitial: {
    fontFamily: type.display,
    fontSize: 128,
    lineHeight: 140,
    color: colors.surfacePressed,
    letterSpacing: 2,
  },
  fallbackBadge: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRow: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  distanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(11,12,13,0.62)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  content: {
    position: 'absolute',
    left: spacing.gutter,
    right: spacing.gutter,
    bottom: spacing.gutter,
    gap: spacing.xs,
  },
  nameText: { letterSpacing: 0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  metaBit: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(11,12,13,0.55)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  dot: { width: 3, height: 3, borderRadius: radius.full, backgroundColor: colors.textDim },
});

export function GymCard({ gym }: { gym: GymPublicCard }) {
  const photoUrl = gym.photos[0]?.deliveryUrl;
  const topRated = gym.rating !== null && gym.rating >= TOP_RATED_THRESHOLD;
  const initial = gym.name.trim().charAt(0).toUpperCase() || '#';

  const a11yBits = [
    `${gym.name}, ${categoryLabel(gym.category)}`,
    gym.city || null,
    gym.distanceKm !== null ? `${gym.distanceKm.toFixed(1)} kilometres away` : null,
    topRated && gym.rating !== null ? `Top rated, ${gym.rating.toFixed(1)} stars` : null,
  ].filter((v): v is string => v !== null);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${a11yBits.join('. ')}. View details`}
      onPress={() => pushPath(`/gyms/${gym.slug}`)}
      style={styles.card}
    >
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.cover}
          contentFit="cover"
          transition={150}
          recyclingKey={gym.id}
          accessible={false}
        />
      ) : (
        <View style={styles.fallback}>
          <AppText tabular={false} style={styles.fallbackInitial} numberOfLines={1}>
            {initial}
          </AppText>
          <View style={styles.fallbackBadge}>
            <Ionicons name="barbell" size={22} color={colors.accent} />
          </View>
        </View>
      )}

      <LinearGradient colors={[...SCRIM]} style={styles.scrim} pointerEvents="none" />

      {/* Floated badges — top-rated left, distance & crowd right. */}
      <View style={styles.topRow} pointerEvents="none">
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {topRated ? <Tag label="Top rated" variant="filled" /> : null}
          {gym.crowdData ? (
            <View style={styles.distanceChip}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: radius.full,
                  backgroundColor: gym.crowdData.level === 'quiet' ? colors.success : colors.warning,
                }}
              />
              <AppText variant="label" color={colors.text}>
                {gym.crowdData.percentage}% occupied
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {gym.distanceKm !== null ? (
            <View style={styles.distanceChip}>
              <Ionicons name="navigate" size={12} color={colors.text} />
              <AppText variant="label" color={colors.text}>
                {gym.distanceKm.toFixed(1)} km
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      {/* Identity over the scrim. */}
      <View style={styles.content} pointerEvents="none">
        <AppText variant="title" color={colors.text} numberOfLines={1} style={styles.nameText}>
          {gym.name}
        </AppText>
        <View style={styles.metaRow}>
          <View style={styles.metaBit}>
            <Ionicons name="barbell-outline" size={13} color={colors.textDim} />
            <AppText variant="caption" color={colors.textDim}>
              {categoryLabel(gym.category)}
            </AppText>
          </View>
          {gym.city ? (
            <>
              <View style={styles.dot} />
              <View style={styles.metaBit}>
                <Ionicons name="location-outline" size={13} color={colors.textDim} />
                <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                  {gym.city}
                </AppText>
              </View>
            </>
          ) : null}
          {gym.rating !== null ? (
            <View style={styles.ratingPill}>
              <Ionicons name="star" size={12} color={colors.accent} />
              <AppText variant="label" color={colors.text}>
                {gym.rating.toFixed(1)}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}
