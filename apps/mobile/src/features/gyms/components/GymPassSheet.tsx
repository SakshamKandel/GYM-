import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Button, Card, PressableScale, Tag } from '../../../components/ui';
import type { GymPassOption } from '../api';

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
  qrBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.block,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  qrGraphic: {
    width: 140,
    height: 140,
    borderRadius: radius.md,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function GymPassSheet({
  visible,
  onClose,
  gymName,
  passOptions,
  onClaim,
}: {
  visible: boolean;
  onClose: () => void;
  gymName: string;
  passOptions: GymPassOption[];
  onClaim?: (pass: GymPassOption) => void;
}) {
  const [activeTicket, setActiveTicket] = useState<GymPassOption | null>(null);

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <AppText variant="title">{activeTicket ? 'Your Entry Pass' : 'Day Pass & Memberships'}</AppText>
              <AppText variant="caption" color={colors.textDim}>
                {gymName}
              </AppText>
            </View>
            <PressableScale accessibilityRole="button" accessibilityLabel="Close pass modal" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </PressableScale>
          </View>

          {activeTicket ? (
            <View style={styles.qrBox}>
              <Tag label="PASS ACTIVE" variant="filled" />
              <AppText variant="heading">{activeTicket.title}</AppText>
              <View style={styles.qrGraphic}>
                <Ionicons name="qr-code" size={100} color={colors.bg} />
              </View>
              <AppText variant="caption" color={colors.textDim} center>
                Show this QR pass at the front desk for instant entry.
              </AppText>
              <Button label="Back to options" variant="secondary" onPress={() => setActiveTicket(null)} />
            </View>
          ) : (
            <View style={styles.passList}>
              {passOptions.map((pass) => {
                const formattedPrice = `Rs. ${(pass.priceMinor / 100).toLocaleString()}`;
                return (
                  <Card key={pass.id} padding={spacing.lg} style={[styles.passCard, pass.isPopular ? styles.popularCard : null]}>
                    <View style={styles.passTop}>
                      <View style={{ flex: 1, gap: 2 }}>
                        {pass.isPopular ? <Tag label="MOST POPULAR" variant="filled" /> : null}
                        <AppText variant="bodyBold">{pass.title}</AppText>
                      </View>
                      <View style={styles.priceTag}>
                        <AppText variant="title" color={colors.accent}>
                          {formattedPrice}
                        </AppText>
                      </View>
                    </View>

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

                    <Button
                      label={pass.type === 'day_pass' ? 'Get Day Pass' : 'Inquire Pass'}
                      variant={pass.isPopular ? 'primary' : 'secondary'}
                      onPress={() => {
                        if (pass.type === 'day_pass') setActiveTicket(pass);
                        if (onClaim) onClaim(pass);
                      }}
                      style={{ marginTop: spacing.md }}
                    />
                  </Card>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
