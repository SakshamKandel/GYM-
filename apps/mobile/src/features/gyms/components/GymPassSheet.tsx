import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type GymPassOption } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, Card, Sheet, Tag } from '../../../components/ui';

/**
 * A gym's day passes / memberships. Built on the shared `Sheet` so it inherits
 * drag-to-dismiss and the bottom system-bar clearance (the last pass button
 * used to sit under the Android 3-button bar), and the list scrolls inside the
 * sheet so a gym offering three or more passes is never clipped.
 */

const styles = StyleSheet.create({
  gymName: { marginBottom: spacing.md },
  scroll: { flexShrink: 1 },
  passList: { gap: spacing.md, paddingBottom: spacing.xs },
  passCard: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    gap: spacing.sm,
  },
  popularCard: {
    borderColor: colors.accent,
  },
  passTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  passTitle: { flex: 1, gap: 2 },
  priceTag: {
    alignItems: 'flex-end',
  },
  features: { gap: 4, marginTop: spacing.xs },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  passCta: { marginTop: spacing.md },
});

export function GymPassSheet({
  visible,
  onClose,
  gymName,
  passOptions,
  onEnquire,
}: {
  visible: boolean;
  onClose: () => void;
  gymName: string;
  passOptions: GymPassOption[];
  onEnquire?: (pass: GymPassOption) => void;
}) {
  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} title="Passes & memberships">
      <AppText variant="caption" color={colors.textDim} style={styles.gymName}>
        {gymName}
      </AppText>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.passList}
      >
        {passOptions.map((pass) => (
          <Card key={pass.id} padding={spacing.lg} style={[styles.passCard, pass.isPopular ? styles.popularCard : null]}>
            <View style={styles.passTop}>
              <View style={styles.passTitle}>
                {pass.isPopular ? <Tag label="MOST POPULAR" variant="filled" /> : null}
                <AppText variant="bodyBold">{pass.title}</AppText>
              </View>
              <View style={styles.priceTag}>
                <AppText variant="title" color={colors.accent}>
                  {formatMoney(pass.priceMinor, pass.currency)}
                </AppText>
              </View>
            </View>

            {pass.features.length > 0 ? (
              <View style={styles.features}>
                {pass.features.map((feat, i) => (
                  <View key={i} style={styles.featureRow}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <AppText variant="body" color={colors.textDim}>
                      {feat}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}

            {onEnquire ? (
              <Button
                label="Ask gym about this pass"
                variant={pass.isPopular ? 'primary' : 'secondary'}
                onPress={() => onEnquire(pass)}
                style={styles.passCta}
              />
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </Sheet>
  );
}
