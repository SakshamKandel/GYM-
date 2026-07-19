import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, PressableScale } from '../../../components/ui';
import { ApiError, reserveImageUpload, uploadImageAsset } from '../../../lib/api/client';
import { successHaptic, warnHaptic } from '../../../lib/haptics';
import { MealsApiError, submitMealReceipt, type MealPendingCycle } from '../api';
import { mealErrorMessage, paymentMethodLabel } from '../logic';

/**
 * eSewa/Khalti receipt upload for a subscription's weekly billing cycle
 * (plan §3/§8 — the only client-visible way to pay a `meal_billing_cycles`
 * row once it flips `open` → `awaiting_payment`). Mirrors ReceiptUploadPanel's
 * reserve → upload → submitMealReceipt sequence exactly, but targets
 * `cycleId` instead of `orderId` — a subscription only ever reaches this
 * state on a digital (esewa/khalti) payment method (COD subs have no billing
 * cycle), so `method` is always one of those two.
 */

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    resizeMode: 'cover',
  },
});

export function CyclePaymentPanel({
  token,
  cycle,
  method,
  onDone,
}: {
  token: string;
  cycle: MealPendingCycle;
  method: 'esewa' | 'khalti';
  onDone: () => void;
}) {
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: 'dim' | 'error' } | null>(null);

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
        await submitMealReceipt(token, { cycleId: cycle.id, method, receiptUrl: reservation.uid });
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
        Pay {formatMoney(cycle.amountMinor, cycle.currency)} for the week of {cycle.weekStart} to {cycle.weekEnd} via{' '}
        {paymentMethodLabel(method)}, then upload the confirmation screenshot for review.
      </AppText>
      {asset ? (
        <PressableScale accessibilityRole="button" accessibilityLabel="Change receipt photo" onPress={pick}>
          <Image source={{ uri: asset.uri }} style={styles.photoPreview} accessibilityIgnoresInvertColors />
        </PressableScale>
      ) : (
        <Button label="Attach receipt photo" variant="secondary" onPress={pick} />
      )}
      {line ? (
        <AppText variant="caption" color={line.tone === 'error' ? colors.error : colors.textDim}>
          {line.text}
        </AppText>
      ) : null}
      <Button label="Submit receipt" onPress={submit} disabled={!asset} loading={submitting} />
    </View>
  );
}
