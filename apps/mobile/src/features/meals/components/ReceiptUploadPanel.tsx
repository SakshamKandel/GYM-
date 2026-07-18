import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, PressableScale } from '../../../components/ui';
import { ApiError, reserveImageUpload, uploadImageAsset } from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { MealsApiError, submitMealReceipt, type MealOrder } from '../api';
import { mealErrorMessage, paymentMethodLabel } from '../logic';

/**
 * eSewa/Khalti receipt upload for a meal order — shared by the checkout
 * hand-off (right after placing a digital-payment order) and the my-orders
 * screen's "receipt-submitted state" affordance (plan §6), so both submit
 * through the exact same reserve → upload → submitMealReceipt sequence
 * SubscribeScreen.tsx uses for the Nepal manual-payment flow.
 */

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  photoPreview: { width: 120, height: 120, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
});

export function ReceiptUploadPanel({
  token,
  order,
  onDone,
  onSkip,
}: {
  token: string;
  order: MealOrder;
  onDone: () => void;
  onSkip?: () => void;
}) {
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: 'dim' | 'error' | 'success' } | null>(null);
  const method = order.paymentMethod === 'khalti' ? 'khalti' : 'esewa';

  async function pick(): Promise<void> {
    setLine(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setLine({ text: 'Allow photo library access in Settings to attach a receipt.', tone: 'dim' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled) return;
    const picked = result.assets[0];
    if (picked) setAsset(picked);
  }

  function submit(): void {
    if (!asset || submitting) return;
    setSubmitting(true);
    setLine(null);
    void (async () => {
      try {
        const reservation = await reserveImageUpload(token, 'meal_receipt');
        const ext = /\.(\w{2,4})$/.exec(asset.uri)?.[1] ?? 'jpg';
        await uploadImageAsset(reservation, {
          uri: asset.uri,
          name: asset.fileName ?? `receipt.${ext}`,
          type: asset.mimeType ?? 'image/jpeg',
        });
        await submitMealReceipt(token, { orderId: order.id, method, receiptUrl: reservation.uid });
        successHaptic();
        onDone();
      } catch (err) {
        const code = err instanceof ApiError || err instanceof MealsApiError ? err.code : 'network';
        setLine({ text: mealErrorMessage(code), tone: 'error' });
        warnHaptic();
      } finally {
        setSubmitting(false);
      }
    })();
  }

  return (
    <View style={styles.wrap}>
      <AppText variant="body" color={colors.textDim}>
        Pay {formatMoney(order.totalMinor, order.currency)} via {paymentMethodLabel(order.paymentMethod)}, then
        upload the confirmation screenshot for review.
      </AppText>
      {asset ? (
        <PressableScale accessibilityRole="button" accessibilityLabel="Change receipt photo" onPress={pick}>
          <View style={styles.photoPreview} />
        </PressableScale>
      ) : (
        <Button label="Attach receipt photo" variant="secondary" onPress={pick} />
      )}
      {line ? (
        <AppText
          variant="caption"
          color={line.tone === 'error' ? colors.error : line.tone === 'success' ? colors.success : colors.textDim}
        >
          {line.text}
        </AppText>
      ) : null}
      <Button label="Submit receipt" onPress={submit} disabled={!asset} loading={submitting} />
      {onSkip ? <Button label="I'll do this later" variant="ghost" onPress={onSkip} /> : null}
    </View>
  );
}
