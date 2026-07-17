import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  BADGE_CATALOG,
  badgeProgress,
  type BadgeDef,
  type BadgeFamily,
  type BadgeProgress,
} from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  enterDown,
  enterUp,
  FractionStat,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../components/ui';
import { BadgeMedal } from '../components/ui/badges/BadgeMedal';
import { BadgeTile, type BadgeTileStatus } from '../components/ui/badges/BadgeTile';
import { BadgeCelebration } from '../features/gamification/components/BadgeCelebration';
import {
  BADGE_FAMILY_LABEL,
  BadgeDetailSheet,
} from '../features/gamification/components/BadgeDetailSheet';
import { useGamificationBadges } from '../features/gamification/store';
import type { AwardedBadge } from '../lib/api/badges';
import { useGamificationDisplay } from '../state/gamification';
import { useAuth } from '../state/auth';

/**
 * Badges screen — block-language layout: back pill → "BADGES" ScreenHeader
 * with an earned-count meta chip → ONE red hero block carrying the headline
 * FractionStat ("12/42") over a thick progress bar → charcoal "Almost there"
 * rows → family grids on the canvas. Tiles are BadgeMedal silhouettes: tiered
 * metal hexagons for strength clubs, red enamel medals elsewhere; locked =
 * engraved charcoal (threshold badges carry a small in-medal progress bar),
 * verified = gold laurel + check chip (coach-verified strength clubs only).
 * Grids stay on the near-black canvas — locked medals engrave in
 * `colors.surface` and would vanish inside a charcoal card. Challenge badges
 * (`challenge:<id>`) are appended under crew as extras, NOT counted in the
 * "of 42" total (contract §5).
 *
 * Every tile taps through to a detail sheet: description, earned/verified
 * dates, or (locked threshold badges) a progress bar over the caller's OWN
 * stats snapshot. An "Almost there" rail surfaces the three closest locked
 * badges so the next milestone is always one glance away.
 *
 * Respects the "Hide achievements" toggle: the whole screen is reachable only
 * from the profile entry point, which itself hides when the toggle is on —
 * but this screen also self-guards (deep link / back-button edge case) by
 * showing a quiet notice instead of the grid (and no counts anywhere).
 */

const FAMILY_ORDER: BadgeFamily[] = ['strength', 'consistency', 'mileage', 'records', 'crew'];

function badgeStatus(
  badge: BadgeDef,
  earnedByBadgeId: Map<string, AwardedBadge>,
): BadgeTileStatus {
  return earnedByBadgeId.get(badge.id)?.status ?? 'locked';
}

export default function BadgesScreen() {
  const hideGamification = useGamificationDisplay((s) => s.hideGamification);
  const authStatus = useAuth((s) => s.status);
  const badges = useGamificationBadges((s) => s.badges);
  const challengeTitles = useGamificationBadges((s) => s.challengeTitles);
  const stats = useGamificationBadges((s) => s.stats);
  const newlyEarnedIds = useGamificationBadges((s) => s.newlyEarnedIds);
  const hydrate = useGamificationBadges((s) => s.hydrate);
  const clearNewlyEarned = useGamificationBadges((s) => s.clearNewlyEarned);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [detailBadge, setDetailBadge] = useState<BadgeDef | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (authStatus === 'signedIn') void hydrate();
    }, [authStatus, hydrate]),
  );

  const earnedByBadgeId = useMemo(() => {
    const map = new Map<string, AwardedBadge>();
    for (const b of badges) map.set(b.badgeId, b);
    return map;
  }, [badges]);

  const earnedCount = useMemo(
    () => BADGE_CATALOG.filter((b) => earnedByBadgeId.has(b.id)).length,
    [earnedByBadgeId],
  );

  // Challenge extras earned by the caller but not in the launch catalog —
  // shown under crew, excluded from the "of 42" total.
  const challengeExtras = useMemo(
    () =>
      badges
        .filter((b) => b.badgeId.startsWith('challenge:'))
        .map((b) => {
          const id = b.badgeId.slice('challenge:'.length);
          const title = challengeTitles[id];
          const def: BadgeDef = {
            id: b.badgeId,
            family: 'crew',
            name: title ?? 'Challenge',
            description: title
              ? `Completed your coach's "${title}" challenge.`
              : "Completed a coach's monthly challenge.",
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

  // "Almost there" — the three locked catalog badges nearest their threshold
  // (progress > 0 only; needs the stats snapshot). Ties by ratio keep catalog
  // order, which already sorts easiest-first within a family ladder.
  const almostThere = useMemo(() => {
    if (stats === null) return [];
    return BADGE_CATALOG.filter((b) => !earnedByBadgeId.has(b.id))
      .map((badge) => ({ badge, progress: badgeProgress(badge, stats) }))
      .filter(
        (x): x is { badge: BadgeDef; progress: BadgeProgress } =>
          x.progress !== null && x.progress.current > 0 && x.progress.current < x.progress.target,
      )
      .sort((a, b) => b.progress.current / b.progress.target - a.progress.current / a.progress.target)
      .slice(0, 3);
  }, [stats, earnedByBadgeId]);

  // In-medal progress for locked threshold badges (0..1). Event-shaped
  // badges have no scalar progress and stay bar-less.
  const progressByBadgeId = useMemo(() => {
    const map = new Map<string, number>();
    if (stats === null) return map;
    for (const badge of BADGE_CATALOG) {
      if (earnedByBadgeId.has(badge.id)) continue;
      const p = badgeProgress(badge, stats);
      if (p !== null && p.target > 0) {
        map.set(badge.id, Math.max(0, Math.min(1, p.current / p.target)));
      }
    }
    return map;
  }, [stats, earnedByBadgeId]);

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
      // Design law 7: "Hide achievements" must suppress XP/rank/badges UI
      // entirely, including the celebration burst — this screen already
      // shows a quiet notice instead of the grid when hidden, so the sheet
      // must not open on top of (or underneath) that notice either.
      if (!hideGamification && newlyEarnedDefs.length > 0) setCelebrationOpen(true);
    }, [newlyEarnedDefs.length, hideGamification]),
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  // Overall completion for the hero bar (0..1 over the fixed catalog).
  const heroRatio = Math.max(0, Math.min(1, earnedCount / BADGE_CATALOG.length));

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

      <ScreenHeader
        title="Badges"
        eyebrow="Achievements"
        meta={
          hideGamification ? undefined : (
            <View style={styles.metaChip}>
              <AppText variant="label" color={colors.text} tabular>
                {`${earnedCount} of ${BADGE_CATALOG.length} earned`}
              </AppText>
            </View>
          )
        }
        style={styles.header}
      />

      {hideGamification ? (
        <Animated.View entering={enterUp(0)}>
          <Card>
            <AppText variant="body" color={colors.textDim}>
              Achievements are hidden. Turn them back on in Settings to see your badges.
            </AppText>
          </Card>
        </Animated.View>
      ) : (
        <>
          <Animated.View entering={enterUp(0)}>
            <Card variant="red" style={styles.hero}>
              <FractionStat
                onBlock
                label="Badges earned"
                value={earnedCount}
                total={BADGE_CATALOG.length}
              />
              <View style={styles.heroTrack}>
                <View style={[styles.heroFill, { width: `${heroRatio * 100}%` }]} />
              </View>
            </Card>
          </Animated.View>

          {almostThere.length > 0 ? (
            <Animated.View entering={enterUp(1)}>
              <SectionLabel>Almost there</SectionLabel>
              <View style={styles.almostList}>
                {almostThere.map(({ badge, progress }) => {
                  const ratio = Math.max(0, Math.min(1, progress.current / progress.target));
                  return (
                    <PressableScale
                      key={badge.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${badge.name}, ${Math.round(ratio * 100)} percent there`}
                      onPress={() => setDetailBadge(badge)}
                      style={styles.almostCard}
                    >
                      <BadgeMedal badge={badge} status="locked" size={34} />
                      <View style={styles.almostInfo}>
                        <AppText variant="bodyBold" numberOfLines={1}>
                          {badge.name}
                        </AppText>
                        <View style={styles.almostBarTrack}>
                          <View style={[styles.almostBarFill, { width: `${ratio * 100}%` }]} />
                        </View>
                      </View>
                      <AppText variant="label" tabular>
                        {Math.round(ratio * 100)}%
                      </AppText>
                    </PressableScale>
                  );
                })}
              </View>
            </Animated.View>
          ) : null}

          {FAMILY_ORDER.map((family, familyIndex) => {
            const list = grouped.get(family) ?? [];
            if (list.length === 0) return null;
            const familyEarned = list.filter((b) => earnedByBadgeId.has(b.id)).length;
            return (
              <Animated.View key={family} entering={enterUp(familyIndex + 2)}>
                <SectionLabel>
                  {`${BADGE_FAMILY_LABEL[family]} · ${familyEarned}/${list.length}`}
                </SectionLabel>
                <View style={styles.grid}>
                  {list.map((badge) => (
                    <BadgeTile
                      key={badge.id}
                      badge={badge}
                      status={badgeStatus(badge, earnedByBadgeId)}
                      progress={progressByBadgeId.get(badge.id) ?? null}
                      onPress={() => setDetailBadge(badge)}
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
          // Flip visibility first so the sheet, medal, and particle burst run
          // their own ~160ms fade/slide exit. Clearing the newly-earned set
          // synchronously would empty `badges` and make BadgeCelebration
          // return null on the same frame, skipping that documented close — so
          // defer the clear until the exit has finished.
          setCelebrationOpen(false);
          setTimeout(clearNewlyEarned, 220);
        }}
      />

      <BadgeDetailSheet
        visible={detailBadge !== null && !hideGamification}
        onClose={() => setDetailBadge(null)}
        badge={detailBadge}
        earned={detailBadge ? (earnedByBadgeId.get(detailBadge.id) ?? null) : null}
        stats={stats}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.xl },
  // Meta chip on dark (brief §6): outlined pill — chips MAY carry borders,
  // the no-border law is for cards. Informational, not pressable.
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  // Red hero block — the screen's single energetic center (brief §2/§11b).
  hero: { gap: spacing.md },
  heroTrack: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.15)', // sanctioned: bar track on a colored block
    overflow: 'hidden',
  },
  heroFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.onBlock,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },

  // Almost there rail — borderless charcoal rows (brief §11c).
  almostList: { gap: spacing.sm },
  almostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  almostInfo: { flex: 1, gap: spacing.sm, minWidth: 0 },
  almostBarTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  almostBarFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});
