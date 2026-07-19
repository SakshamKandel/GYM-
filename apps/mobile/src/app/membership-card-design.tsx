import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
} from '../components/ui';
import { CARD_DESIGN_LIST } from '../features/subscription/components/cardDesigns';
import { useCardDesign } from '../state/cardDesign';
import { useAuth } from '../state/auth';
import { useProfile } from '../state/profile';

/**
 * /membership-card-design — pick which of the 10 card faces represents the
 * member's own membership card. Each row renders the REAL card component at
 * full size with the member's own tier/name so the preview is exactly what
 * they'll see on their card, not a mockup.
 */
export default function MembershipCardDesignScreen() {
  const user = useAuth((s) => s.user);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const displayName = useProfile((s) => s.displayName);
  const designId = useCardDesign((s) => s.designId);
  const setDesignId = useCardDesign((s) => s.setDesignId);

  const tier = user?.tier ?? 'starter';
  const memberId = user?.id ?? null;
  const holderName = displayName || user?.displayName || 'Athlete';

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
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

      <ScreenHeader eyebrow="Membership card" title="Choose a design" style={styles.header} />
      <AppText variant="caption" color={colors.textDim} style={styles.headerCaption}>
        Pick the face your card shows everywhere — Settings and the front-desk screen.
      </AppText>

      <View style={styles.list}>
        {CARD_DESIGN_LIST.map((design, index) => {
          const selected = design.id === designId;
          const Face = design.Component;
          return (
            <Animated.View key={design.id} entering={enterUp(Math.min(index, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${design.label} card design${selected ? ', selected' : ''}`}
                onPress={() => setDesignId(design.id)}
                style={[styles.row, selected && styles.rowSelected]}
              >
                <View style={styles.cardWrap}>
                  <Face
                    tier={tier}
                    holderName={holderName}
                    memberId={memberId}
                    signedIn={signedIn}
                    expiresAt={user?.tierExpiresAt ?? null}
                  />
                </View>
                <View style={styles.rowFooter}>
                  <View style={styles.rowText}>
                    <AppText variant="bodyBold">{design.label}</AppText>
                    <AppText variant="caption" color={colors.textDim}>
                      {design.description}
                    </AppText>
                  </View>
                  <View style={[styles.check, selected && styles.checkOn]}>
                    {selected ? <Ionicons name="checkmark" size={16} color={colors.bg} /> : null}
                  </View>
                </View>
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.sm },
  headerCaption: { marginBottom: spacing.gutter },
  list: { gap: spacing.lg, marginBottom: spacing.xl },
  row: {
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: spacing.md,
  },
  rowSelected: { borderColor: colors.accent },
  cardWrap: { width: '100%' },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  check: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
