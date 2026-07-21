import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  Card,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  PressableScale,
  Screen,
  SkeletonRow,
  Tag,
} from '../../components/ui';
import { EmptyArt } from '../../components/visual';
import { useAuth } from '../../state/auth';
import { useMealPartners } from '../../features/meals/hooks';
import { pushPath } from '../../features/meals/nav';
import type { MealPartner } from '../../features/meals/api';

/**
 * Meals tab — order-a-meal partner discovery hub (plan §6 P12), promoted from
 * /meals to its own bottom tab. Mirrors the gyms tab's screen skeleton
 * (Screen scroll, load-on-focus with skeleton rows + a quiet retry, never a
 * blocking error screen), gated on sign-in since every meals route is a
 * member-only surface.
 *
 * Visual language (2026-07-21 professional pass): a single red hero block
 * carries the brand statement + the member's quick links (Orders / Plans) as
 * black onBlock pills; partner kitchens list below as chunky block cards with
 * a monogram tile, delivery-area line and service badges.
 */

const styles = StyleSheet.create({
  hero: { gap: spacing.md },
  heroTitle: {
    fontFamily: type.display,
    fontSize: type.size.heading,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  heroCopy: { maxWidth: 300 },
  heroLinks: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  heroLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.onBlock,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
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
  skeletons: { gap: spacing.md },
  skeletonRow: { backgroundColor: colors.surface, borderRadius: radius.block, padding: spacing.lg, height: 108 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  monogram: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramLetter: {
    fontFamily: type.display,
    fontSize: 26,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  cardMain: { flex: 1, gap: 3 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
});

function PartnerCard({ partner, index }: { partner: MealPartner; index: number }) {
  const areas = partner.serviceAreas.slice(0, 3).join(', ');
  const initial = partner.name.trim().charAt(0) || '?';
  return (
    <Animated.View entering={enterUp(Math.min(index, 4))}>
      <Card
        onPress={() => pushPath(`/meals/${partner.id}`)}
        accessibilityLabel={`${partner.name}${areas ? `, delivers to ${areas}` : ''}. View menu`}
      >
        <View style={styles.cardTop}>
          <View style={styles.monogram} accessible={false} importantForAccessibility="no-hide-descendants">
            <AppText style={styles.monogramLetter}>{initial}</AppText>
          </View>
          <View style={styles.cardMain}>
            <AppText variant="title" numberOfLines={1}>
              {partner.name}
            </AppText>
            <View style={styles.areaRow}>
              <Ionicons name="location-outline" size={14} color={colors.textDim} />
              <AppText variant="caption" color={colors.textDim} numberOfLines={1} style={{ flex: 1 }}>
                {areas || 'Delivery area not listed'}
              </AppText>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
        </View>
        <View style={styles.badgeRow}>
          {partner.acceptsCod ? <Tag label="Cash on delivery" variant="dim" /> : null}
          <Tag label="Lunch & dinner" variant="dim" />
          <Tag label="View menu" variant="outline" color={colors.accent} />
        </View>
      </Card>
    </Animated.View>
  );
}

export default function MealsTabScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const { data: partners, loading, error, retry } = useMealPartners(status === 'signedIn' ? token : null);

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      <Animated.View entering={enterDown()}>
        <Card variant="red" style={styles.hero}>
          <AppText variant="label" color={colors.onBlock}>
            GM Meals
          </AppText>
          <AppText style={styles.heroTitle} color={colors.onBlock}>
            Fuel, delivered.
          </AppText>
          <AppText variant="body" color={colors.onBlock} style={styles.heroCopy}>
            Macro-tracked meals from partner kitchens, on your training schedule.
          </AppText>
          {status === 'signedIn' ? (
            <View style={styles.heroLinks}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="My meal orders"
                onPress={() => pushPath('/meals/orders')}
                style={styles.heroLink}
              >
                <Ionicons name="receipt-outline" size={16} color={colors.text} />
                <AppText variant="bodyBold">Orders</AppText>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="My meal subscriptions"
                onPress={() => pushPath('/meals/subscriptions')}
                style={styles.heroLink}
              >
                <Ionicons name="repeat-outline" size={16} color={colors.text} />
                <AppText variant="bodyBold">Plans</AppText>
              </PressableScale>
            </View>
          ) : null}
        </Card>
      </Animated.View>

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(1)} style={{ marginTop: spacing.xl }}>
          <EmptyState
            icon="restaurant"
            title="Sign in to order meals"
            body="Browse partner menus, order once, or set up a weekly plan on your account."
            art={<EmptyArt variant="food" />}
            actionLabel="Sign in"
            onAction={() => pushPath('/auth/sign-in')}
          />
        </Animated.View>
      ) : (
        <>
          <View style={styles.sectionLabelRow}>
            <AppText variant="label">Partner kitchens</AppText>
            {partners !== null && partners.length > 0 ? (
              <AppText variant="caption" color={colors.textFaint}>
                {partners.length} {partners.length === 1 ? 'kitchen' : 'kitchens'}
              </AppText>
            ) : null}
          </View>

          {error ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Couldn't load meal partners. Tap to retry."
                onPress={retry}
                style={styles.retryRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.retryText}>
                  {partners === null ? "Couldn't load partners — tap to retry." : 'Showing last known list — tap to retry.'}
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          {loading ? (
            <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading meal partners">
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonRow key={i} style={styles.skeletonRow} />
              ))}
            </Animated.View>
          ) : partners !== null && partners.length === 0 ? (
            <Animated.View entering={enterUp(0)}>
              <EmptyState
                icon="restaurant"
                title="No partners yet"
                body="Meal delivery partners are on the way — check back soon."
              />
            </Animated.View>
          ) : partners !== null ? (
            <View style={styles.list}>
              {partners.map((p, i) => (
                <PartnerCard key={p.id} partner={p} index={i} />
              ))}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
