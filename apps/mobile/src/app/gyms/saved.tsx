import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  EmptyState,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Skeleton,
} from '../../components/ui';
import { useAuth } from '../../state/auth';
import { GymCard } from '../../features/gyms/components/GymCard';
import { useFavoriteGyms } from '../../features/gyms/hooks';
import { replacePath } from '../../features/gyms/nav';

/**
 * /gyms/saved — the member's shortlist (Pack M — fixes B15's "no way to save
 * a gym for later"). Member-only screen; a signed-out visitor is bounced to
 * sign-in rather than shown an empty state that can never fill (favoriting
 * requires an account everywhere else in this feature).
 */

const styles = StyleSheet.create({
  header: { marginBottom: spacing.md },
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: spacing.md },
  skeletons: { gap: spacing.md },
  unavailableWrap: { opacity: 0.5 },
  unavailableTag: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(11,12,13,0.7)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
});

function goBack(): void {
  if (router.canGoBack()) router.back();
  else replacePath('/gyms');
}

export default function SavedGymsScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const { gyms, loading, error, retry } = useFavoriteGyms(status === 'signedIn' ? token : null);

  const backButton = (
    <View style={styles.backRow}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </PressableScale>
    </View>
  );

  if (status !== 'signedIn') {
    return (
      <Screen scroll>
        {backButton}
        <EmptyState
          icon="heart"
          title="Sign in to see your saved gyms"
          body="Favorite a gym from its page and it'll show up here."
          actionLabel="Sign in"
          onAction={() => replacePath('/auth/sign-in')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {backButton}
      <ScreenHeader eyebrow="Your shortlist" title="Saved gyms" style={styles.header} />

      {error ? (
        <Animated.View entering={enterFade(0)}>
          <EmptyState
            icon="cloud-offline"
            title="Couldn't load your saved gyms"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={retry}
          />
        </Animated.View>
      ) : loading ? (
        <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading saved gyms">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={208} radius={radius.block} />
          ))}
        </Animated.View>
      ) : gyms !== null && gyms.length === 0 ? (
        <Animated.View entering={enterUp(0)}>
          <EmptyState
            icon="heart-outline"
            title="No saved gyms yet"
            body="Tap the heart on a gym's page to shortlist it here."
            actionLabel="Browse gyms"
            onAction={() => replacePath('/gyms')}
          />
        </Animated.View>
      ) : (
        <Animated.View entering={enterUp(0)} style={styles.list}>
          {gyms?.map((gym) => (
            <View key={gym.id} style={gym.unavailable ? styles.unavailableWrap : undefined}>
              <GymCard gym={gym} />
              {gym.unavailable ? (
                <View style={styles.unavailableTag} pointerEvents="none">
                  <AppText variant="label" color={colors.text}>
                    No longer listed
                  </AppText>
                </View>
              ) : null}
            </View>
          ))}
        </Animated.View>
      )}
    </Screen>
  );
}
