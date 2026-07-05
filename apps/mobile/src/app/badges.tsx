import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BADGE_CATALOG, type BadgeDef, type BadgeFamily } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  SectionLabel,
} from '../components/ui';
import { BadgeTile, type BadgeTileStatus } from '../components/ui/badges/BadgeTile';
import { BadgeCelebration } from '../features/gamification/components/BadgeCelebration';
import { useGamificationBadges } from '../features/gamification/store';
import { useGamificationDisplay } from '../state/gamification';
import { useAuth } from '../state/auth';

/**
 * Badges screen — grid grouped by family, "N of 44 earned" header. Locked
 * tiles show a charcoal outline glyph; earned tiles fill red; verified adds a
 * small check overlay (coach-verified strength clubs only). Challenge badges
 * (`challenge:<id>`) are appended under crew as extras, NOT counted in the
 * "of 44" total (contract §5).
 *
 * Respects the "Hide gamification" toggle: the whole screen is reachable only
 * from the profile entry point, which itself hides when the toggle is on —
 * but this screen also self-guards (deep link / back-button edge case) by
 * showing a quiet notice instead of the grid.
 */

const FAMILY_LABEL: Record<BadgeFamily, string> = {
  strength: 'Strength clubs',
  consistency: 'Consistency',
  mileage: 'Iron mileage',
  records: 'Records',
  crew: 'Coach & crew',
};

const FAMILY_ORDER: BadgeFamily[] = ['strength', 'consistency', 'mileage', 'records', 'crew'];

function badgeStatus(
  badge: BadgeDef,
  earnedByBadgeId: Map<string, 'logged' | 'verified'>,
): BadgeTileStatus {
  return earnedByBadgeId.get(badge.id) ?? 'locked';
}

export default function BadgesScreen() {
  const hideGamification = useGamificationDisplay((s) => s.hideGamification);
  const authStatus = useAuth((s) => s.status);
  const badges = useGamificationBadges((s) => s.badges);
  const challengeTitles = useGamificationBadges((s) => s.challengeTitles);
  const newlyEarnedIds = useGamificationBadges((s) => s.newlyEarnedIds);
  const hydrate = useGamificationBadges((s) => s.hydrate);
  const clearNewlyEarned = useGamificationBadges((s) => s.clearNewlyEarned);
  const [celebrationOpen, setCelebrationOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (authStatus === 'signedIn') void hydrate();
    }, [authStatus, hydrate]),
  );

  const earnedByBadgeId = useMemo(() => {
    const map = new Map<string, 'logged' | 'verified'>();
    for (const b of badges) map.set(b.badgeId, b.status);
    return map;
  }, [badges]);

  const earnedCount = useMemo(
    () => BADGE_CATALOG.filter((b) => earnedByBadgeId.has(b.id)).length,
    [earnedByBadgeId],
  );

  // Challenge extras earned by the caller but not in the launch catalog —
  // shown under crew, excluded from the "of 44" total.
  const challengeExtras = useMemo(
    () =>
      badges
        .filter((b) => b.badgeId.startsWith('challenge:'))
        .map((b) => {
          const id = b.badgeId.slice('challenge:'.length);
          const def: BadgeDef = {
            id: b.badgeId,
            family: 'crew',
            name: challengeTitles[id] ?? 'Challenge',
            icon: 'award',
            sort: 900,
          };
          return def;
        }),
    [badges, challengeTitles],
  );

  const grouped = useMemo(() => {
    const map = new Map<BadgeFamily, BadgeDef[]>();
    for (const family of FAMILY_ORDER) map.set(family, []);
    for (const badge of BADGE_CATALOG) map.get(badge.family)!.push(badge);
    map.get('crew')!.push(...challengeExtras);
    return map;
  }, [challengeExtras]);

  const newlyEarnedDefs = useMemo(() => {
    if (newlyEarnedIds.length === 0) return [];
    const all = [...BADGE_CATALOG, ...challengeExtras];
    return newlyEarnedIds.flatMap((id) => {
      const def = all.find((b) => b.id === id);
      return def ? [def] : [];
    });
  }, [newlyEarnedIds, challengeExtras]);

  useFocusEffect(
    useCallback(() => {
      // Design law 7: "Hide gamification" must suppress XP/rank/badges UI
      // entirely, including the celebration burst — this screen already
      // shows a quiet notice instead of the grid when hidden, so the sheet
      // must not open on top of (or underneath) that notice either.
      if (!hideGamification && newlyEarnedDefs.length > 0) setCelebrationOpen(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newlyEarnedDefs.length, hideGamification]),
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  return (
    <Screen scroll>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <AppText variant="heading">Badges</AppText>
      </Animated.View>

      {hideGamification ? (
        <Animated.View entering={enterUp(0)} style={styles.hiddenNotice}>
          <AppText variant="body" color={colors.textDim}>
            Gamification is hidden. Turn it back on in Settings to see your badges.
          </AppText>
        </Animated.View>
      ) : (
        <>
          <Animated.View entering={enterUp(0)}>
            <AppText variant="title" style={styles.countLine}>
              {earnedCount} of {BADGE_CATALOG.length} earned
            </AppText>
          </Animated.View>

          {FAMILY_ORDER.map((family, familyIndex) => {
            const list = grouped.get(family) ?? [];
            if (list.length === 0) return null;
            return (
              <Animated.View key={family} entering={enterUp(familyIndex + 1)}>
                <SectionLabel>{FAMILY_LABEL[family]}</SectionLabel>
                <View style={styles.grid}>
                  {list.map((badge) => (
                    <BadgeTile
                      key={badge.id}
                      icon={badge.icon}
                      name={badge.name}
                      status={badgeStatus(badge, earnedByBadgeId)}
                    />
                  ))}
                </View>
              </Animated.View>
            );
          })}
        </>
      )}

      <BadgeCelebration
        visible={celebrationOpen && !hideGamification}
        badges={newlyEarnedDefs}
        onClose={() => {
          setCelebrationOpen(false);
          clearNewlyEarned();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countLine: { marginBottom: spacing.xs },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  hiddenNotice: {
    paddingVertical: spacing.xxl,
  },
});
