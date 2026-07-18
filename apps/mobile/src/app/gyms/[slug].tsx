import { useMemo, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { distanceKm, GYM_DAY_KEYS, isOpenNow, type GymDayKey } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  Divider,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  SectionLabel,
  Skeleton,
  Tag,
} from '../../components/ui';
import { useAuth } from '../../state/auth';
import { MapPreview } from '../../features/gyms/components/MapPreview';
import { useGymDetail } from '../../features/gyms/hooks';
import { replacePath } from '../../features/gyms/nav';
import { useMealAddresses } from '../../features/meals/hooks';

/**
 * /gyms/[slug] — one gym's full detail page. Section order per plan §4:
 * gallery → header (name/category/rating) → open-now + weekly hours →
 * quick actions (call/website/directions, native Linking) → amenities chips
 * → price note → about → location/address (tap-through to Directions).
 * "See on Google Maps" is an outbound link only — we never republish
 * third-party review text (copyright).
 */

const DAY_LABEL: Record<GymDayKey, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

const AMENITY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  pool: 'water',
  sauna: 'flame',
  steam: 'cloud',
  cardio_zone: 'bicycle',
  free_weights: 'barbell',
  group_classes: 'people',
  personal_training: 'person',
  parking: 'car',
  locker_rooms: 'lock-closed',
  showers: 'water-outline',
  wifi: 'wifi',
  ac: 'snow',
};

function amenityLabel(a: string): string {
  return a.replace('_', ' ');
}

function formatShift(open: string, close: string): string {
  return `${open}–${close}`;
}

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gallery: { marginBottom: spacing.md },
  galleryImage: {
    width: 260,
    height: 180,
    borderRadius: radius.md,
    marginRight: spacing.sm,
  },
  galleryPlaceholder: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginTop: spacing.md,
  },
  openDot: { width: 8, height: 8, borderRadius: radius.full },
  openText: { flex: 1 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  amenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  addressText: { flex: 1 },
  mapPreview: { marginTop: spacing.sm },
  operatorNote: { marginTop: spacing.xs },
  skeletons: { gap: spacing.md },
});

export default function GymDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const gymSlug = typeof slug === 'string' ? slug : '';
  const { gym, loading, notFound, error, retry } = useGymDetail(gymSlug);
  const [now] = useState(() => new Date());

  // Same "default saved delivery address as home base" courtesy as the Gyms
  // tab list (features/gyms never imports features/meals — this screen, not
  // the feature module, composes the two).
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const { data: addresses } = useMealAddresses(status === 'signedIn' ? token : null);
  const defaultAddress = addresses?.find((a) => a.isDefault) ?? addresses?.[0] ?? null;
  const memberPoint =
    defaultAddress && defaultAddress.lat !== null && defaultAddress.lng !== null
      ? { lat: defaultAddress.lat, lng: defaultAddress.lng }
      : null;
  const gymDistanceKm =
    gym && memberPoint && gym.lat !== null && gym.lng !== null
      ? distanceKm(memberPoint, { lat: gym.lat, lng: gym.lng })
      : null;

  const openStatus = useMemo(() => (gym ? isOpenNow(gym.hours, now) : null), [gym, now]);
  const todayIdx = useMemo(() => {
    const shifted = new Date(now.getTime() + 345 * 60_000);
    return shifted.getUTCDay();
  }, [now]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replacePath('/gyms');
  }

  function call(): void {
    if (gym?.phone) void Linking.openURL(`tel:${gym.phone.replace(/[^\d+]/g, '')}`);
  }

  function openWebsite(): void {
    if (gym?.website) void Linking.openURL(gym.website);
  }

  function openDirections(): void {
    if (!gym) return;
    const destination =
      gym.lat !== null && gym.lng !== null
        ? `${gym.lat},${gym.lng}`
        : encodeURIComponent([gym.addressText, gym.city].filter(Boolean).join(', ') || gym.name);
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`);
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      {notFound ? (
        <EmptyState
          icon="business"
          title="Gym not found"
          body="This listing may have been removed."
          actionLabel="Browse gyms"
          onAction={goBack}
        />
      ) : gym === null ? (
        error ? (
          <EmptyState
            icon="cloud-offline"
            title="Couldn't load this gym"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={retry}
          />
        ) : (
          <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading gym">
            <Skeleton height={180} radius={radius.md} />
            <Skeleton height={60} />
            <Skeleton height={100} />
          </Animated.View>
        )
      ) : (
        <>
          {/* ── Gallery ── */}
          <Animated.View entering={enterUp(0)} style={styles.gallery}>
            {gym.photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {gym.photos.map((p) => (
                  <Image key={p.id} source={{ uri: p.deliveryUrl }} style={styles.galleryImage} accessibilityIgnoresInvertColors />
                ))}
              </ScrollView>
            ) : (
              <View style={styles.galleryPlaceholder}>
                <IconChip icon="business" size={56} />
              </View>
            )}
          </Animated.View>

          {/* ── Header: name, category, rating ── */}
          <Animated.View entering={enterUp(1)}>
            <View style={styles.nameRow}>
              <AppText variant="title">{gym.name}</AppText>
              <Tag label={gym.category.replace('_', ' ')} variant="dim" />
            </View>
            <View style={styles.metaRow}>
              {gym.rating !== null ? (
                <>
                  <Ionicons name="star" size={14} color={colors.accent} />
                  <AppText variant="caption" color={colors.textDim}>
                    {gym.rating.toFixed(1)}
                    {gym.reviewCount !== null ? ` (${gym.reviewCount})` : ''}
                  </AppText>
                </>
              ) : null}
              {gymDistanceKm !== null ? (
                <>
                  <Ionicons name="navigate-outline" size={14} color={colors.textDim} />
                  <AppText variant="caption" color={colors.textDim}>
                    ~{gymDistanceKm.toFixed(1)} km away
                  </AppText>
                </>
              ) : null}
            </View>

            {/* ── Open-now status ── */}
            <View style={styles.openRow}>
              <View
                style={[
                  styles.openDot,
                  { backgroundColor: openStatus?.open ? colors.success : colors.textFaint },
                ]}
              />
              <AppText variant="caption" color={colors.textDim} style={styles.openText}>
                {openStatus?.open
                  ? `Open now${openStatus.closesAt ? ` · closes ${openStatus.closesAt}` : ''}`
                  : 'Closed now'}
              </AppText>
            </View>

            {/* ── Quick actions ── */}
            <View style={styles.actionsRow}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={gym.phone ? `Call ${gym.name}` : 'Phone number unavailable'}
                onPress={call}
                style={styles.actionBtn}
                disabled={!gym.phone}
              >
                <Ionicons name="call" size={18} color={gym.phone ? colors.text : colors.textFaint} />
                <AppText variant="label" color={gym.phone ? colors.text : colors.textFaint}>
                  Call
                </AppText>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={gym.website ? 'Open website' : 'Website unavailable'}
                onPress={openWebsite}
                style={styles.actionBtn}
                disabled={!gym.website}
              >
                <Ionicons name="globe" size={18} color={gym.website ? colors.text : colors.textFaint} />
                <AppText variant="label" color={gym.website ? colors.text : colors.textFaint}>
                  Website
                </AppText>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Get directions"
                onPress={openDirections}
                style={styles.actionBtn}
              >
                <Ionicons name="navigate" size={18} color={colors.text} />
                <AppText variant="label">Directions</AppText>
              </PressableScale>
            </View>
          </Animated.View>

          {/* ── Weekly hours ── */}
          <Animated.View entering={enterUp(2)}>
            <SectionLabel>Hours</SectionLabel>
            <Card padding={spacing.lg}>
              {GYM_DAY_KEYS.map((day, i) => {
                const shifts = gym.hours[day] ?? [];
                const isToday = i === todayIdx;
                return (
                  <View key={day}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.hoursRow}>
                      <AppText variant={isToday ? 'bodyBold' : 'body'} color={isToday ? colors.text : colors.textDim}>
                        {DAY_LABEL[day]}
                      </AppText>
                      <AppText variant={isToday ? 'bodyBold' : 'body'} color={isToday ? colors.text : colors.textDim}>
                        {shifts.length === 0 ? 'Closed' : shifts.map((s) => formatShift(s.open, s.close)).join(', ')}
                      </AppText>
                    </View>
                  </View>
                );
              })}
            </Card>
          </Animated.View>

          {/* ── Amenities ── */}
          {gym.amenities.length > 0 ? (
            <Animated.View entering={enterUp(3)}>
              <SectionLabel>Amenities</SectionLabel>
              <View style={styles.amenities}>
                {gym.amenities.map((a) => (
                  <View key={a} style={styles.amenityChip}>
                    <Ionicons name={AMENITY_ICON[a] ?? 'checkmark-circle'} size={16} color={colors.textDim} />
                    <AppText variant="label">{amenityLabel(a)}</AppText>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          {/* ── Price note ── */}
          {gym.priceNote ? (
            <Animated.View entering={enterUp(4)}>
              <SectionLabel>Membership</SectionLabel>
              <AppText variant="body" color={colors.textDim}>
                {gym.priceNote}
              </AppText>
            </Animated.View>
          ) : null}

          {/* ── About ── */}
          {gym.description ? (
            <Animated.View entering={enterUp(5)}>
              <SectionLabel>About</SectionLabel>
              <AppText variant="body" color={colors.textDim}>
                {gym.description}
              </AppText>
            </Animated.View>
          ) : null}

          {/* ── Location ── */}
          {(gym.addressText || gym.city) ? (
            <Animated.View entering={enterUp(6)}>
              <SectionLabel>Location</SectionLabel>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${[gym.addressText, gym.city].filter(Boolean).join(', ')}. Get directions`}
                onPress={openDirections}
                style={styles.addressRow}
              >
                <Ionicons name="location" size={18} color={colors.textDim} />
                <AppText variant="body" style={styles.addressText}>
                  {[gym.addressText, gym.city, gym.district].filter(Boolean).join(', ')}
                </AppText>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </PressableScale>
              {gym.lat !== null && gym.lng !== null ? (
                <View style={styles.mapPreview}>
                  <MapPreview
                    lat={gym.lat}
                    lng={gym.lng}
                    onPress={openDirections}
                    accessibilityLabel={`Map preview of ${gym.name}'s location. Tap for directions`}
                  />
                </View>
              ) : null}
            </Animated.View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
