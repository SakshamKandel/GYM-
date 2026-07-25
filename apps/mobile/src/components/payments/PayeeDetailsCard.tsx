import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../ui';
import { copyToClipboard } from '../../lib/clipboard';
import { successHaptic } from '../../lib/haptics';
import type { Payee, PayeeRail } from '../../lib/api/payee';

/**
 * Where to send the money, shown directly above every receipt uploader.
 *
 * The app used to ask members to "transfer first, then upload the receipt"
 * without naming a wallet, an account or a QR anywhere, so the only working way
 * to buy anything could not be completed. This card is that missing half: the
 * exact destination, spelled out before the member is asked for a receipt.
 *
 * Ids and account numbers get a copy button (48dp touch target, its own label
 * for screen readers) because retyping a wallet number into another app is how
 * money reaches the wrong account.
 *
 * It renders only the rails the caller is actually offering (`rails`), so a
 * member paying by eSewa is not handed a bank account as well.
 */

const RAIL_LABEL: Record<PayeeRail, string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  bank: 'Bank transfer',
};

export function PayeeDetailsCard({
  payee,
  rails,
  amountLabel,
}: {
  payee: Payee;
  /** Rails to show. Defaults to every rail this payee supports. */
  rails?: PayeeRail[];
  /** Optional formatted amount, so the heading names the exact sum to send. */
  amountLabel?: string;
}) {
  const shown = (rails ?? ['esewa', 'khalti', 'bank']).filter((rail) => {
    if (rail === 'esewa') return payee.esewa !== null;
    if (rail === 'khalti') return payee.khalti !== null;
    return payee.bank !== null;
  });
  if (shown.length === 0) return null;

  return (
    <View style={styles.card}>
      <AppText variant="label">{amountLabel ? `Send ${amountLabel} to` : 'Send the money to'}</AppText>

      {shown.map((rail) => (
        <View key={rail} style={styles.rail}>
          <AppText variant="bodyBold">{RAIL_LABEL[rail]}</AppText>
          {rail === 'esewa' && payee.esewa ? (
            <>
              {payee.esewa.name ? <NameLine name={payee.esewa.name} /> : null}
              <CopyRow label="eSewa ID" value={payee.esewa.id} />
            </>
          ) : null}
          {rail === 'khalti' && payee.khalti ? (
            <>
              {payee.khalti.name ? <NameLine name={payee.khalti.name} /> : null}
              <CopyRow label="Khalti ID" value={payee.khalti.id} />
            </>
          ) : null}
          {rail === 'bank' && payee.bank ? (
            <>
              {payee.bank.bankName ? <NameLine name={payee.bank.bankName} /> : null}
              <NameLine name={payee.bank.accountName} />
              <CopyRow label="Account number" value={payee.bank.accountNumber} />
            </>
          ) : null}
        </View>
      ))}

      {payee.qrImageUrl ? (
        <View style={styles.qrWrap}>
          <AppText variant="caption" color={colors.textDim}>
            Or scan this to pay
          </AppText>
          <Image
            source={{ uri: payee.qrImageUrl }}
            style={styles.qr}
            accessibilityLabel="Payment QR code"
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : null}

      {payee.instructions ? (
        <AppText variant="caption" color={colors.textDim}>
          {payee.instructions}
        </AppText>
      ) : null}
    </View>
  );
}

/** Account-holder line — read-only context, nothing to copy. */
function NameLine({ name }: { name: string }) {
  return (
    <AppText variant="caption" color={colors.textDim}>
      {name}
    </AppText>
  );
}

/**
 * One identifier with a copy button. The value stays on screen either way, so
 * a device that refuses the copy (web without clipboard permission) still
 * leaves the member something they can read and type.
 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    void (async () => {
      const ok = await copyToClipboard(value);
      if (!ok) return;
      successHaptic();
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    })();
  }, [value]);

  return (
    <View style={styles.copyRow}>
      <View style={styles.copyMain}>
        <AppText variant="caption" color={colors.textFaint}>
          {label}
        </AppText>
        <AppText variant="title" tabular>
          {value}
        </AppText>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        onPress={copy}
        style={styles.copyBtn}
      >
        <Ionicons
          name={copied ? 'checkmark' : 'copy-outline'}
          size={20}
          color={copied ? colors.success : colors.text}
        />
      </PressableScale>
      {copied ? (
        <AppText variant="caption" color={colors.success}>
          Copied
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  rail: { gap: spacing.xs },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  copyMain: { flex: 1, gap: 2 },
  copyBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfacePressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrWrap: { gap: spacing.sm, alignItems: 'flex-start' },
  qr: {
    width: 176,
    height: 176,
    borderRadius: radius.sm,
    backgroundColor: colors.surfacePressed,
    resizeMode: 'contain',
  },
});
