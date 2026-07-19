import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, Chip } from '../../../components/ui';
import { fileMealDispute, toMealsError, type MealDisputeReason } from '../api';
import { DISPUTE_REASONS, disputeReasonLabel, mealErrorMessage } from '../logic';
import { warnHaptic } from '../../../lib/haptics';

/**
 * "Report a problem" — the non-delivery / dispute rail (Pack E). Only ever
 * rendered from a terminal delivered/paid order; resolution is
 * admin-authoritative and NEVER auto-refunds (this only files the case and
 * pings staff — see `@gym/shared`'s disputes.ts and the WP-3 dispute route).
 */

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  doneWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
});

interface Props {
  token: string;
  orderId: string;
  onDone: () => void;
}

export function DisputePanel({ token, orderId, onDone }: Props) {
  const [reason, setReason] = useState<MealDisputeReason | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(): void {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        await fileMealDispute(token, orderId, { reason, note: note.trim() || undefined });
        setDone(true);
        onDone();
      } catch (err) {
        setError(mealErrorMessage(toMealsError(err).code));
        warnHaptic();
      } finally {
        setSubmitting(false);
      }
    })();
  }

  if (done) {
    return (
      <View style={styles.doneWrap}>
        <Ionicons name="checkmark-circle" size={28} color={colors.success} />
        <AppText variant="bodyBold">We&apos;ve got your report</AppText>
        <AppText variant="caption" color={colors.textDim} center>
          Our team will review this order and follow up.
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <AppText variant="body" color={colors.textDim}>
        What went wrong?
      </AppText>
      <View style={styles.reasonRow}>
        {DISPUTE_REASONS.map((r) => (
          <Chip key={r} label={disputeReasonLabel(r)} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <AppTextInput
        value={note}
        onChangeText={setNote}
        placeholder="Add details (optional)"
        accessibilityLabel="Problem details"
        multiline
      />
      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}
      <Button label="Report to support" onPress={submit} disabled={!reason} loading={submitting} />
    </View>
  );
}
