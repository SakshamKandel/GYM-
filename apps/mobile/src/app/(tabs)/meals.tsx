import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  FLOATING_TAB_SPACE,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
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
 * (Screen scroll, ScreenHeader, load-on-focus with skeleton rows + a quiet
 * retry, never a blocking error screen), gated on sign-in since every meals
 * route is a member-only surface.
 */

const styles = StyleSheet.create({
  quickRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.lg },
  quickLinks: { flexDirection: 'row', gap: spacing.sm },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  header: { marginBottom: spacing.md },
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
  list: { gap: spacing.sm },
  skeletons: { gap: spacing.sm },
  skeletonRow: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 76,
  },
  rowMain: { flex: 1, gap: 2 },
});

function PartnerRow({ partner }: { partner: MealPartner }) {
  const areas = partner.serviceAreas.slice(0, 3).join(', ');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${partner.name}${areas ? `, delivers to ${areas}` : ''}. View menu`}
      onPress={() => pushPath(`/meals/${partner.id}`)}
      style={styles.row}
    >
      <IconChip icon="restaurant" />
      <View style={styles.rowMain}>
        <AppText variant="bodyBold" numberOfLines={1}>
          {partner.name}
        </AppText>
        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
          {areas || 'Delivery area not listed'}
        </AppText>
      </View>
      {partner.acceptsCod ? <Tag label="COD" variant="dim" /> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </PressableScale>
  );
}

export default function MealsTabScreen() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const { data: partners, loading, error, retry } = useMealPartners(status === 'signedIn' ? token : null);

  return (
    <Screen scroll bottomInset={FLOATING_TAB_SPACE}>
      {status === 'signedIn' ? (
        <Animated.View entering={enterDown()} style={styles.quickRow}>
          <View style={styles.quickLinks}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="My meal orders"
              onPress={() => pushPath('/meals/orders')}
              style={styles.quickLink}
            >
              <Ionicons name="receipt-outline" size={16} color={colors.text} />
              <AppText variant="caption">Orders</AppText>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="My meal subscriptions"
              onPress={() => pushPath('/meals/subscriptions')}
              style={styles.quickLink}
            >
              <Ionicons name="repeat-outline" size={16} color={colors.text} />
              <AppText variant="caption">Plans</AppText>
            </PressableScale>
          </View>
        </Animated.View>
      ) : null}

      <ScreenHeader eyebrow="Fuel your training" title="Order meals" style={styles.header} />

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(0)}>
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
            <Animated.View entering={enterUp(0)} style={styles.list}>
              {partners.map((p) => (
                <PartnerRow key={p.id} partner={p} />
              ))}
            </Animated.View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
