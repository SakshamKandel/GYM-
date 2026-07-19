import { useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { Ionicons } from '@expo/vector-icons';
import {
  AppText,
  AppTextInput,
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
import { useGymDirectory } from '../../features/gyms/hooks';
import { useMealAddresses } from '../../features/meals/hooks';

/**
 * Gyms tab — Nearby Gyms discovery hub (plan §4/§6), promoted from /gyms to
 * its own bottom tab. Public: no sign-in wall, mirroring /coaches' skeleton
 * (Screen scroll, ScreenHeader, load-on-focus with skeleton rows + a quiet
 * retry row, never a blocking error screen) — the API is unauthenticated too.
 */

const styles = StyleSheet.create({
  header: { marginBottom: spacing.md },
  banner: { marginBottom: spacing.gutter },
  search: { marginBottom: spacing.md },
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
  skeletons: { gap: spacing.md },
});

export default function GymsTabScreen() {
  // The member's default saved delivery address doubles as their "home base"
  // for gym distance sorting/labels when they're signed in and it has coords
  // — a courtesy reuse of meals data, not a new location permission/module.
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const { data: addresses } = useMealAddresses(status === 'signedIn' ? token : null);
  const defaultAddress = addresses?.find((a) => a.isDefault) ?? addresses?.[0] ?? null;
  const coords =
    defaultAddress && defaultAddress.lat !== null && defaultAddress.lng !== null
      ? { lat: defaultAddress.lat, lng: defaultAddress.lng }
      : null;

  const { gyms, loading, error, retry } = useGymDirectory(coords);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered =
    gyms === null
      ? null
      : q
        ? gyms.filter((g) => g.name.toLowerCase().includes(q) || g.city.toLowerCase().includes(q))
        : gyms;

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <ScreenHeader eyebrow="Train anywhere" title="Nearby gyms" style={styles.header} />

      <Animated.View entering={enterUp(0)}>
        <PhotoHero
          source={stockImages.gymInteriorBright}
          size="banner"
          recyclingKey="gyms-banner"
          accessibilityLabel="A bright modern gym interior"
          chip={{ label: 'Discover' }}
          title="Find a gym near you"
          caption="Hours, amenities, and directions in one place."
          style={styles.banner}
        />
      </Animated.View>

      <Animated.View entering={enterUp(1)} style={styles.search}>
        <AppTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or city…"
          accessibilityLabel="Search gyms by name or city"
        />
      </Animated.View>

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
              {gyms === null ? "Couldn't load gyms — tap to retry." : 'Showing last known list — tap to retry.'}
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
            title={q ? 'No matches' : 'No gyms yet'}
            body={q ? 'Try a different name or city.' : 'Gym listings are on the way — check back soon.'}
          />
        </Animated.View>
      ) : filtered !== null ? (
        <Animated.View entering={enterUp(0)} style={styles.list}>
          {filtered.map((gym) => (
            <GymCard key={gym.id} gym={gym} />
          ))}
        </Animated.View>
      ) : null}
    </Screen>
  );
}
