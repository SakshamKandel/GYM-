import { Modal, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type GymPassOption } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Button, Card, PressableScale, Tag } from '../../../components/ui';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.gutter,
    gap: spacing.lg,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passList: { gap: spacing.md },
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
  priceTag: {
    alignItems: 'flex-end',
  },
  features: { gap: 4, marginTop: spacing.xs },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
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
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <AppText variant="title">Passes & memberships</AppText>
              <AppText variant="caption" color={colors.textDim}>
                {gymName}
              </AppText>
            </View>
            <PressableScale accessibilityRole="button" accessibilityLabel="Close pass modal" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </PressableScale>
          </View>

          <View style={styles.passList}>
            {passOptions.map((pass) => (
              <Card key={pass.id} padding={spacing.lg} style={[styles.passCard, pass.isPopular ? styles.popularCard : null]}>
                <View style={styles.passTop}>
                  <View style={{ flex: 1, gap: 2 }}>
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
                    style={{ marginTop: spacing.md }}
                  />
                ) : null}
              </Card>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}
