import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { distanceKm, GYM_DAY_KEYS, type GymDayKey } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  Divider,
  EmptyState,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  SectionLabel,
  Skeleton,
  Tag,
} from '../../components/ui';
import { useAuth } from '../../state/auth';
import { GymActionBar } from '../../features/gyms/components/GymActionBar';
import { GymGallery } from '../../features/gyms/components/GymGallery';
import { MapPreview } from '../../features/gyms/components/MapPreview';
import { amenityIcon, amenityLabel } from '../../features/gyms/amenities';
import { describeOpenState, formatShift } from '../../features/gyms/hours';
import { useGymDetail } from '../../features/gyms/hooks';
import { replacePath } from '../../features/gyms/nav';
import { useMealAddresses } from '../../features/meals/hooks';

/**
 * /gyms/[slug] — one gym's full detail page (brief §2). Scanning order:
 * gallery → identity (name/category/verified/open-now) → sticky action bar
 * (Call/Directions/Website) → amenities grid → full week hours → location
 * (map + address + distance) → about. "Verified" is truthful: the public API
 * only ever returns admin-verified, published gyms. Directions/website are
 * outbound Linking handoffs — we never republish third-party review text.
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

/** Space reserved at the bottom of the scroll so content clears the bar. */
const ACTION_BAR_SPACE = 76;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryWrap: { marginBottom: spacing.lg },
  backFloat: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11,12,13,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  metaBit: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.min,
    marginTop: spacing.lg,
  },
  openDot: { width: 9, height: 9, borderRadius: radius.full },
  openText: { flex: 1 },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  todayTag: { marginLeft: spacing.sm },
  hoursDayBit: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  amenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingVertical: spacing.sm,
  },
  amenityIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
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
  distanceLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  mapPreview: { marginTop: spacing.md },
  skeletons: { gap: spacing.md },
});

export default function GymDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const gymSlug = typeof slug === 'string' ? slug : '';
  const { gym, notFound, error, retry } = useGymDetail(gymSlug);
  const [now] = useState(() => new Date());

  // The member's default saved delivery address doubles as their "home base"
  // for distance (features/gyms never imports features/meals — this screen
  // composes the two).
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

  const openState = useMemo(() => (gym ? describeOpenState(gym.hours, now) : null), [gym, now]);
  const todayIdx = useMemo(() => new Date(now.getTime() + 345 * 60_000).getUTCDay(), [now]);

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
    <View style={styles.root}>
      <Screen scroll bottomInset={gym ? ACTION_BAR_SPACE : 0}>
        {notFound ? (
          <>
            <View style={styles.backRow}>
              <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </PressableScale>
            </View>
            <EmptyState
              icon="business"
              title="Gym not found"
              body="This listing may have been removed."
              actionLabel="Browse gyms"
              onAction={goBack}
            />
          </>
        ) : gym === null ? (
          <>
            <View style={styles.backRow}>
              <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </PressableScale>
            </View>
            {error ? (
              <EmptyState
                icon="cloud-offline"
                title="Couldn't load this gym"
                body="Check your connection and try again."
                actionLabel="Try again"
                onAction={retry}
              />
            ) : (
              <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading gym">
                <Skeleton height={268} radius={radius.block} />
                <Skeleton height={28} width="70%" />
                <Skeleton height={56} />
                <Skeleton height={120} />
              </Animated.View>
            )}
          </>
        ) : (
          <>
            {/* ── Gallery + floating back ── */}
            <Animated.View entering={enterUp(0)} style={styles.galleryWrap}>
              <GymGallery photos={gym.photos} name={gym.name} category={gym.category.replace(/_/g, ' ')} />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={goBack}
                style={styles.backFloat}
              >
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </PressableScale>
            </Animated.View>

            {/* ── Identity ── */}
            <Animated.View entering={enterUp(1)}>
              <View style={styles.nameRow}>
                <AppText variant="heading">{gym.name}</AppText>
              </View>
              <View style={styles.metaRow}>
                <View style={styles.metaBit}>
                  <Ionicons name="barbell-outline" size={14} color={colors.textDim} />
                  <AppText variant="caption" color={colors.textDim}>
                    {gym.category.replace(/_/g, ' ')}
                  </AppText>
                </View>
                <View style={[styles.metaBit, styles.verifiedPill]}>
                  <Ionicons name="shield-checkmark" size={14} color={colors.success} />
                  <AppText variant="caption" color={colors.textDim}>
                    Verified
                  </AppText>
                </View>
                {gym.rating !== null ? (
                  <View style={styles.metaBit}>
                    <Ionicons name="star" size={14} color={colors.accent} />
                    <AppText variant="caption" color={colors.textDim}>
                      {gym.rating.toFixed(1)}
                      {gym.reviewCount !== null ? ` (${gym.reviewCount})` : ''}
                    </AppText>
                  </View>
                ) : null}
              </View>

              {/* Open-now line */}
              {openState ? (
                <View style={styles.openRow}>
                  <View
                    style={[styles.openDot, { backgroundColor: openState.open ? colors.success : colors.textFaint }]}
                  />
                  <AppText
                    variant="bodyBold"
                    color={openState.open ? colors.success : colors.textDim}
                    style={styles.openText}
                  >
                    {openState.label}
                  </AppText>
                </View>
              ) : null}
            </Animated.View>

            {/* ── Amenities ── */}
            {gym.amenities.length > 0 ? (
              <Animated.View entering={enterUp(2)}>
                <SectionLabel>Amenities</SectionLabel>
                <View style={styles.amenities}>
                  {gym.amenities.map((a) => (
                    <View key={a} style={styles.amenityChip}>
                      <View style={styles.amenityIconWrap}>
                        <Ionicons name={amenityIcon(a)} size={15} color={colors.accent} />
                      </View>
                      <AppText variant="label" color={colors.text}>
                        {amenityLabel(a)}
                      </AppText>
                    </View>
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {/* ── Weekly hours ── */}
            <Animated.View entering={enterUp(3)}>
              <SectionLabel>Hours</SectionLabel>
              <Card padding={spacing.lg}>
                {GYM_DAY_KEYS.map((day, i) => {
                  const shifts = gym.hours[day] ?? [];
                  const isToday = i === todayIdx;
                  return (
                    <View key={day}>
                      {i > 0 ? <Divider /> : null}
                      <View style={styles.hoursRow}>
                        <View style={styles.hoursDayBit}>
                          <AppText
                            variant={isToday ? 'bodyBold' : 'body'}
                            color={isToday ? colors.text : colors.textDim}
                          >
                            {DAY_LABEL[day]}
                          </AppText>
                          {isToday ? (
                            <View style={styles.todayTag}>
                              <Tag label="Today" variant="filled" />
                            </View>
                          ) : null}
                        </View>
                        <AppText
                          variant={isToday ? 'bodyBold' : 'body'}
                          color={isToday ? colors.text : colors.textDim}
                        >
                          {shifts.length === 0
                            ? 'Closed'
                            : shifts.map((s) => formatShift(s.open, s.close)).join(', ')}
                        </AppText>
                      </View>
                    </View>
                  );
                })}
              </Card>
            </Animated.View>

            {/* ── Location ── */}
            {gym.addressText || gym.city || (gym.lat !== null && gym.lng !== null) ? (
              <Animated.View entering={enterUp(4)}>
                <SectionLabel>Location</SectionLabel>
                {gym.addressText || gym.city ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${[gym.addressText, gym.city].filter(Boolean).join(', ')}. Get directions`}
                    onPress={openDirections}
                    style={styles.addressRow}
                  >
                    <Ionicons name="location" size={18} color={colors.accent} />
                    <AppText variant="body" style={styles.addressText}>
                      {[gym.addressText, gym.city, gym.district].filter(Boolean).join(', ')}
                    </AppText>
                    <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                  </PressableScale>
                ) : null}
                {gymDistanceKm !== null ? (
                  <View style={styles.distanceLine}>
                    <Ionicons name="navigate-outline" size={14} color={colors.textDim} />
                    <AppText variant="caption" color={colors.textDim}>
                      About {gymDistanceKm.toFixed(1)} km from your saved address
                    </AppText>
                  </View>
                ) : null}
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

            {/* ── Membership ── */}
            {gym.priceNote ? (
              <Animated.View entering={enterUp(5)}>
                <SectionLabel>Membership</SectionLabel>
                <AppText variant="body" color={colors.textDim}>
                  {gym.priceNote}
                </AppText>
              </Animated.View>
            ) : null}

            {/* ── About ── */}
            {gym.description ? (
              <Animated.View entering={enterUp(6)}>
                <SectionLabel>About</SectionLabel>
                <AppText variant="body" color={colors.textDim}>
                  {gym.description}
                </AppText>
              </Animated.View>
            ) : null}
          </>
        )}
      </Screen>

      {gym ? (
        <GymActionBar
          gymName={gym.name}
          onDirections={openDirections}
          onCall={gym.phone ? call : undefined}
          onWebsite={gym.website ? openWebsite : undefined}
        />
      ) : null}
    </View>
  );
}
