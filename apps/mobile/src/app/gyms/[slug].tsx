import { useEffect, useMemo, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { distanceKm, GYM_DAY_KEYS, type GymDayKey } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
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
import { GymDetailTopActions } from '../../features/gyms/components/GymDetailTopActions';
import { GymGallery } from '../../features/gyms/components/GymGallery';
import { GymReviewsSection } from '../../features/gyms/components/GymReviewsSection';
import { MapPreview } from '../../features/gyms/components/MapPreview';
import { EnquireSheet } from '../../features/gyms/components/EnquireSheet';
import { ReportGymSheet } from '../../features/gyms/components/ReportGymSheet';
import { GymCrowdMeter } from '../../features/gyms/components/GymCrowdMeter';
import { GymEquipmentList } from '../../features/gyms/components/GymEquipmentList';
import { GymPassSheet } from '../../features/gyms/components/GymPassSheet';
import { amenityIcon, amenityLabel } from '../../features/gyms/amenities';
import { favoriteGym, unfavoriteGym } from '../../features/gyms/api';
import { describeOpenState, formatShift } from '../../features/gyms/hours';
import { useGymDetail } from '../../features/gyms/hooks';
import { pushPath, replacePath } from '../../features/gyms/nav';
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
  topActionsFloat: { position: 'absolute', top: spacing.md, right: spacing.md },
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
  priceNote: { marginBottom: spacing.md },
  unavailableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  membershipActions: { gap: spacing.sm },
  reportRow: { alignItems: 'center', marginTop: spacing.sm },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
  },
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

  const hasHours = gym !== null && Object.keys(gym.hours).length > 0;
  const openState = useMemo(
    () => (gym && Object.keys(gym.hours).length > 0 ? describeOpenState(gym.hours, now) : null),
    [gym, now],
  );
  const todayIdx = useMemo(() => new Date(now.getTime() + 345 * 60_000).getUTCDay(), [now]);

  // ── Favorite / share / enquire / report (Pack M — fixes B15/B17) ──
  const isSignedIn = status === 'signedIn';
  const [favorited, setFavorited] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [enquireOpen, setEnquireOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);

  const canOpenDirections = Boolean(
    gym &&
      ((gym.lat !== null && gym.lng !== null) || gym.addressText.trim() || gym.city.trim()),
  );
  const hasBottomAction = Boolean(gym && (canOpenDirections || gym.phone || gym.website));

  // Seed local favorite state from the detail payload once per gym (not on
  // every focus refetch, so an optimistic toggle here never gets clobbered by
  // the screen's own reload — see useGymDetail's useFocusEffect).
  useEffect(() => {
    if (gym) setFavorited(gym.isFavorited);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gym?.id]);

  function requireSignIn(): boolean {
    if (isSignedIn && token) return true;
    pushPath('/auth/sign-in');
    return false;
  }

  async function toggleFavorite(): Promise<void> {
    if (!gym || !requireSignIn() || !token) return;
    const next = !favorited;
    setFavorited(next); // optimistic — confirms in <100ms (hard-rule 5 spirit)
    setFavoriteBusy(true);
    try {
      if (next) await favoriteGym(gym.slug, token);
      else await unfavoriteGym(gym.slug, token);
    } catch {
      setFavorited(!next); // roll back on a real failure (no dedicated error
      // surface for a background toggle — the icon reverting IS the signal)
    } finally {
      setFavoriteBusy(false);
    }
  }

  function shareGym(): void {
    if (!gym || !canOpenDirections) return;
    const locationBit = [gym.addressText, gym.city].filter(Boolean).join(', ');
    void Share.share({
      message: `${gym.name}${locationBit ? ` — ${locationBit}` : ''}\ngymtracker://gyms/${gym.slug}`,
      title: gym.name,
    });
  }

  function openEnquire(): void {
    if (requireSignIn()) setEnquireOpen(true);
  }

  function openReport(): void {
    if (requireSignIn()) setReportOpen(true);
  }

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
      <Screen scroll bottomInset={hasBottomAction ? ACTION_BAR_SPACE : 0}>
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
              <View style={styles.topActionsFloat}>
                <GymDetailTopActions
                  onShare={shareGym}
                  favorite={{ active: favorited, busy: favoriteBusy, onToggle: () => void toggleFavorite(), gymName: gym.name }}
                />
              </View>
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

            {/* ── Backend-reported crowd data ── */}
            <Animated.View entering={enterUp(2)}>
              <SectionLabel>Crowd & peak hours</SectionLabel>
              {gym.crowdData ? (
                <GymCrowdMeter crowd={gym.crowdData} />
              ) : (
                <View accessible accessibilityLabel="Crowd data unavailable">
                  <Card padding={spacing.lg} style={styles.unavailableCard}>
                    <Ionicons name="information-circle-outline" size={20} color={colors.textDim} />
                    <AppText variant="body" color={colors.textDim}>
                      Crowd data has not been provided by this gym.
                    </AppText>
                  </Card>
                </View>
              )}
            </Animated.View>

            {/* ── Equipment & Zones ── */}
            <Animated.View entering={enterUp(4)}>
              <SectionLabel>Equipment & zones</SectionLabel>
              {gym.equipment.length > 0 ? (
                <GymEquipmentList equipment={gym.equipment} />
              ) : (
                <View accessible accessibilityLabel="Equipment details unavailable">
                  <Card padding={spacing.lg} style={styles.unavailableCard}>
                    <Ionicons name="information-circle-outline" size={20} color={colors.textDim} />
                    <AppText variant="body" color={colors.textDim}>
                      Equipment details have not been provided by this gym.
                    </AppText>
                  </Card>
                </View>
              )}
            </Animated.View>

            {/* ── Amenities ── */}
            {gym.amenities.length > 0 ? (
              <Animated.View entering={enterUp(5)}>
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
            <Animated.View entering={enterUp(6)}>
              <SectionLabel>Hours</SectionLabel>
              {hasHours ? (
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
              ) : (
                <View accessible accessibilityLabel="Opening hours unavailable">
                  <Card padding={spacing.lg} style={styles.unavailableCard}>
                    <Ionicons name="information-circle-outline" size={20} color={colors.textDim} />
                    <AppText variant="body" color={colors.textDim}>
                      Opening hours have not been provided by this gym.
                    </AppText>
                  </Card>
                </View>
              )}
            </Animated.View>

            {/* ── Location ── */}
            {gym.addressText || gym.city || (gym.lat !== null && gym.lng !== null) ? (
              <Animated.View entering={enterUp(7)}>
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
                      addressText={gym.addressText}
                      city={gym.city}
                      gymName={gym.name}
                      height={220}
                      onPress={openDirections}
                      accessibilityLabel={`Map preview of ${gym.name}'s location. Tap for directions`}
                    />
                  </View>
                ) : null}
              </Animated.View>
            ) : null}

            {/* ── Membership ── */}
            <Animated.View entering={enterUp(8)}>
              <SectionLabel>Membership</SectionLabel>
              {gym.priceNote ? (
                <AppText variant="body" color={colors.textDim} style={styles.priceNote}>
                  {gym.priceNote}
                </AppText>
              ) : null}
              {gym.passOptions.length === 0 && !gym.priceNote ? (
                <View accessible accessibilityLabel="Pass pricing unavailable">
                  <Card padding={spacing.lg} style={styles.unavailableCard}>
                    <Ionicons name="information-circle-outline" size={20} color={colors.textDim} />
                    <AppText variant="body" color={colors.textDim}>
                      Pass prices have not been provided by this gym.
                    </AppText>
                  </Card>
                </View>
              ) : null}
              <View style={styles.membershipActions}>
                {gym.passOptions.length > 0 ? (
                  <Button label="View passes & prices" variant="secondary" onPress={() => setPassOpen(true)} />
                ) : null}
                <Button label="Ask about membership" variant="secondary" onPress={openEnquire} />
              </View>
            </Animated.View>

            {/* ── About ── */}
            {gym.description ? (
              <Animated.View entering={enterUp(9)}>
                <SectionLabel>About</SectionLabel>
                <AppText variant="body" color={colors.textDim}>
                  {gym.description}
                </AppText>
              </Animated.View>
            ) : null}

            {/* ── Reviews (Pack C write path) ── */}
            <Animated.View entering={enterUp(7)}>
              <GymReviewsSection
                gymSlug={gym.slug}
                gymName={gym.name}
                isSignedIn={isSignedIn}
                token={isSignedIn ? token : null}
              />
            </Animated.View>

            {/* ── Report incorrect info ── */}
            <Animated.View entering={enterUp(8)} style={styles.reportRow}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Report incorrect information about this gym"
                onPress={openReport}
                style={styles.reportBtn}
              >
                <Ionicons name="flag-outline" size={14} color={colors.textDim} />
                <AppText variant="caption" color={colors.textDim}>
                  Report incorrect info
                </AppText>
              </PressableScale>
            </Animated.View>
          </>
        )}
      </Screen>

      {gym && hasBottomAction ? (
        <GymActionBar
          gymName={gym.name}
          {...(canOpenDirections ? { onDirections: openDirections } : {})}
          {...(gym.phone ? { onCall: call } : {})}
          {...(gym.website ? { onWebsite: openWebsite } : {})}
        />
      ) : null}

      {gym && isSignedIn && token ? (
        <>
          <EnquireSheet
            visible={enquireOpen}
            onClose={() => setEnquireOpen(false)}
            gymSlug={gym.slug}
            gymName={gym.name}
            token={token}
          />
          <ReportGymSheet
            visible={reportOpen}
            onClose={() => setReportOpen(false)}
            gymSlug={gym.slug}
            gymName={gym.name}
            token={token}
          />
        </>
      ) : null}

      {gym && gym.passOptions.length > 0 ? (
        <GymPassSheet
          visible={passOpen}
          onClose={() => setPassOpen(false)}
          gymName={gym.name}
          passOptions={gym.passOptions}
          onEnquire={() => {
            setPassOpen(false);
            openEnquire();
          }}
        />
      ) : null}
    </View>
  );
}
