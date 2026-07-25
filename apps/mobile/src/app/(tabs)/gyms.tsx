import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { Ionicons } from '@expo/vector-icons';
import { GYM_CATEGORIES } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Card,
  Chip,
  EmptyState,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  PhotoHero,
  PressableScale,
  Screen,
  ScreenHeader,
  Skeleton,
  stockImages,
} from '../../components/ui';
import { useAuth } from '../../state/auth';
import { GymCard } from '../../features/gyms/components/GymCard';
import { MapPreview } from '../../features/gyms/components/MapPreview';
import { GymFilterModal, type GymFilterState } from '../../features/gyms/components/GymFilterModal';
import { useGymDirectory, type GymDirectoryState } from '../../features/gyms/hooks';
import { pushPath } from '../../features/gyms/nav';
import { useMealAddresses } from '../../features/meals/hooks';

/** Lifts the 40dp List/Map pills to a 48dp target without growing the pill
 * itself; vertical only, so the two adjacent pills never overlap. */
const SEGMENT_HIT_SLOP = { top: 4, bottom: 4 } as const;

/**
 * What the tab shows while it is still waiting to know where "near you" is:
 * exactly the loading state the directory itself reports before its first
 * answer, so the screen looks the same either way.
 */
const PENDING_DIRECTORY: GymDirectoryState = {
  gyms: null,
  loading: true,
  error: false,
  retry: () => {},
};

/**
 * Holds the directory load and renders nothing.
 *
 * The listings are fetched with the member's saved address as the starting
 * point for distances, and that address arrives from its own request. Asking
 * for the directory before it lands meant one request with no coordinates
 * (thrown away the moment the address arrived) and a second one with them, on
 * every cold focus. Mounting the load here, only once the address question has
 * an answer, makes it one request — and because the screen itself never
 * unmounts, nothing on it restarts or flickers when that answer comes.
 */
function GymDirectoryLoader({
  coords,
  onState,
}: {
  coords: { lat: number; lng: number } | null;
  onState: (state: GymDirectoryState) => void;
}) {
  const { gyms, loading, error, retry } = useGymDirectory(coords);
  useEffect(() => {
    onState({ gyms, loading, error, retry });
  }, [gyms, loading, error, retry, onState]);
  return null;
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.sm },
  banner: { marginBottom: spacing.md },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1 },
  filterBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentFaint,
  },
  categoriesScroll: {
    marginBottom: spacing.md,
    marginHorizontal: -spacing.gutter,
  },
  categoriesRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.gutter,
  },
  viewModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  segmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    minHeight: 40,
  },
  segmentBtnActive: {
    backgroundColor: colors.accent,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginBottom: spacing.md,
  },
  retryText: { flex: 1 },
  list: { gap: spacing.md },
  mapList: { gap: spacing.md },
  mapUnavailable: {
    minHeight: 120,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  skeletons: { gap: spacing.md },
  savedBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function GymsTabScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const authedToken = status === 'signedIn' ? token : null;
  const { data: addresses, error: addressesError } = useMealAddresses(authedToken);
  const defaultAddress = addresses?.find((a) => a.isDefault) ?? addresses?.[0] ?? null;
  const coords =
    defaultAddress && defaultAddress.lat !== null && defaultAddress.lng !== null
      ? { lat: defaultAddress.lat, lng: defaultAddress.lng }
      : null;
  const [directory, setDirectory] = useState<GymDirectoryState>(PENDING_DIRECTORY);
  const { gyms, loading, error, retry } = directory;
  // The saved-address question has an answer: a list came back, the request
  // failed, or there is no account to have one. Signed out settles instantly,
  // so nothing waits on a request that is never made. Listings already on
  // screen settle it too — a sign-in mid-browse must never blank them back to
  // skeletons while the new account's address is fetched.
  const homeBaseSettled =
    authedToken === null || addresses !== null || addressesError || gyms !== null;
  const [query, setQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<GymFilterState>({ radiusKm: null, category: null });

  const q = query.trim().toLowerCase();
  const filtered = gyms === null
    ? null
    : gyms.filter((g) => {
        if (q && !g.name.toLowerCase().includes(q) && !g.city.toLowerCase().includes(q)) return false;
        if (selectedCat && g.category !== selectedCat) return false;
        if (filters.category && g.category !== filters.category) return false;
        if (filters.radiusKm !== null && g.distanceKm !== null && g.distanceKm > filters.radiusKm) return false;
        return true;
      });

  // Mirrors exactly what the filter above applies — the highlight must never
  // promise a filter the list can't honour.
  const hasActiveFilters = filters.radiusKm !== null || filters.category !== null;

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      {homeBaseSettled ? <GymDirectoryLoader coords={coords} onState={setDirectory} /> : null}

      <ScreenHeader
        eyebrow="Train anywhere"
        title="Nearby gyms"
        style={styles.header}
        action={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="View your saved gyms"
            onPress={() => pushPath('/gyms/saved')}
            style={styles.savedBtn}
          >
            <Ionicons name="heart-outline" size={20} color={colors.text} />
          </PressableScale>
        }
      />

      <Animated.View entering={enterUp(0)}>
        <PhotoHero
          source={stockImages.gymInteriorBright}
          size="banner"
          recyclingKey="gyms-banner"
          accessibilityLabel="A bright modern gym interior"
          chip={{ label: 'Discover' }}
          title="Find a gym near you"
          caption="Verified hours, amenities, and contact details in one place."
          style={styles.banner}
        />
      </Animated.View>

      {/* Search and filter trigger */}
      <Animated.View entering={enterUp(1)} style={styles.searchRow}>
        <View style={styles.searchInput}>
          <AppTextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or city…"
            accessibilityLabel="Search gyms by name or city"
          />
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Open filters"
          onPress={() => setFilterOpen(true)}
          style={[styles.filterBtn, hasActiveFilters ? styles.filterBtnActive : null]}
        >
          <Ionicons name="options-outline" size={20} color={hasActiveFilters ? colors.accent : colors.text} />
        </PressableScale>
      </Animated.View>

      {/* Category pills row */}
      <Animated.View entering={enterUp(2)} style={styles.categoriesScroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          <Chip label="All gyms" selected={selectedCat === null} onPress={() => setSelectedCat(null)} />
          {GYM_CATEGORIES.map((cat) => (
            <Chip
              key={cat}
              label={cat.replace(/_/g, ' ')}
              selected={selectedCat === cat}
              onPress={() => setSelectedCat(cat)}
            />
          ))}
        </ScrollView>
      </Animated.View>

      {/* View Mode Switcher Header */}
      <View style={styles.viewModeRow}>
        <AppText variant="caption" color={colors.textDim}>
          {filtered !== null ? `${filtered.length} listings found` : 'Loading listings…'}
        </AppText>
        <View style={styles.segmentBox}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Show gyms as a list"
            accessibilityState={{ selected: viewMode === 'list' }}
            hitSlop={SEGMENT_HIT_SLOP}
            onPress={() => setViewMode('list')}
            style={[styles.segmentBtn, viewMode === 'list' ? styles.segmentBtnActive : null]}
          >
            <Ionicons name="list" size={14} color={viewMode === 'list' ? colors.onBlock : colors.textDim} />
            <AppText variant="label" color={viewMode === 'list' ? colors.onBlock : colors.textDim}>
              List
            </AppText>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Show gyms on a map"
            accessibilityState={{ selected: viewMode === 'map' }}
            hitSlop={SEGMENT_HIT_SLOP}
            onPress={() => setViewMode('map')}
            style={[styles.segmentBtn, viewMode === 'map' ? styles.segmentBtnActive : null]}
          >
            <Ionicons name="map" size={14} color={viewMode === 'map' ? colors.onBlock : colors.textDim} />
            <AppText variant="label" color={viewMode === 'map' ? colors.onBlock : colors.textDim}>
              Map
            </AppText>
          </PressableScale>
        </View>
      </View>

      {error ? (
        <Animated.View entering={enterFade(0)}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Couldn't load gyms. Tap to retry."
            onPress={retry}
            style={styles.retryRow}
          >
            <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
            <AppText variant="caption" style={styles.retryText}>
              {gyms === null ? "Couldn't load gyms. Tap to retry." : 'Showing last known list. Tap to retry.'}
            </AppText>
            <Ionicons name="refresh" size={15} color={colors.textDim} />
          </PressableScale>
        </Animated.View>
      ) : null}

      {loading ? (
        <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading gyms">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={208} radius={radius.block} />
          ))}
        </Animated.View>
      ) : filtered !== null && filtered.length === 0 ? (
        <Animated.View entering={enterUp(0)}>
          <EmptyState
            icon="business"
            title={q || selectedCat ? 'No matches' : 'No gyms yet'}
            body={q || selectedCat ? 'Try adjusting your search or filters.' : 'Gym listings are on the way. Check back soon.'}
          />
        </Animated.View>
      ) : filtered !== null ? (
        viewMode === 'list' ? (
          <Animated.View entering={enterUp(0)} style={styles.list}>
            {filtered.map((gym) => (
              <GymCard key={gym.id} gym={gym} />
            ))}
          </Animated.View>
        ) : (
          <Animated.View entering={enterUp(0)} style={styles.mapList}>
            {filtered.map((gym) => (
              <Card key={gym.id} padding={spacing.md} style={{ gap: spacing.sm }}>
                {gym.lat !== null && gym.lng !== null ? (
                  <MapPreview
                    lat={gym.lat}
                    lng={gym.lng}
                    city={gym.city}
                    gymName={gym.name}
                    height={180}
                    onPress={() => pushPath(`/gyms/${gym.slug}`)}
                    accessibilityLabel={`Map preview of ${gym.name}'s location. Tap for details`}
                  />
                ) : (
                  <View
                    style={styles.mapUnavailable}
                    accessible
                    accessibilityLabel={`Map location unavailable for ${gym.name}`}
                  >
                    <Ionicons name="map-outline" size={24} color={colors.textDim} />
                    <AppText variant="body" color={colors.textDim} center>
                      Map location unavailable for this gym.
                    </AppText>
                  </View>
                )}
                <GymCard gym={gym} />
              </Card>
            ))}
          </Animated.View>
        )
      ) : null}

      <GymFilterModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        initialState={filters}
        onApply={(next) => setFilters(next)}
      />
    </Screen>
  );
}
