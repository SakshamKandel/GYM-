import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, Chip, Sheet } from '../../../components/ui';
import { GymsApiError, reportGym, type GymReportField } from '../api';

/**
 * "Report incorrect info" sheet (Pack M — fixes B15). Feeds the admin
 * moderation queue at /admin/gyms/reports. `field` mirrors the exact enum on
 * `gym_reports.field` in schema.ts.
 */

const FIELD_OPTIONS: { value: GymReportField; label: string }[] = [
  { value: 'hours', label: 'Hours' },
  { value: 'phone', label: 'Phone' },
  { value: 'address', label: 'Address' },
  { value: 'location', label: 'Map pin' },
  { value: 'closed', label: 'Permanently closed' },
  { value: 'other', label: 'Something else' },
];

const NOTE_MAX = 500;

interface Props {
  visible: boolean;
  onClose: () => void;
  gymSlug: string;
  gymName: string;
  token: string;
}

const styles = StyleSheet.create({
  intro: { marginBottom: spacing.lg },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  note: { marginBottom: spacing.lg, minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  error: { marginBottom: spacing.md },
  successRow: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
});

export function ReportGymSheet({ visible, onClose, gymSlug, gymName, token }: Props) {
  const [field, setField] = useState<GymReportField | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!field) {
      setError('Choose what looks wrong first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reportGym(gymSlug, { field, note: note.trim() || undefined }, token);
      setSubmitting(false);
      setSent(true);
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof GymsApiError && err.code === 'rate_limited'
          ? "You've reported a few of these already — try again later."
          : "Couldn't send your report — check your connection and try again.",
      );
    }
  }

  function handleClose() {
    setField(null);
    setNote('');
    setSent(false);
    setError(null);
    onClose();
  }

  return (
    <Sheet visible={visible} onClose={handleClose} title={sent ? 'Thanks!' : 'Report incorrect info'}>
      {sent ? (
        <View style={styles.successRow}>
          <Ionicons name="checkmark-circle" size={48} color={colors.success} />
          <AppText variant="body" color={colors.textDim} style={{ textAlign: 'center' }}>
            Thanks for the heads-up — the team will review {gymName}&apos;s listing.
          </AppText>
          <Button label="Done" onPress={handleClose} />
        </View>
      ) : (
        <>
          <AppText variant="body" color={colors.textDim} style={styles.intro}>
            What&apos;s wrong with this listing?
          </AppText>
          <View style={styles.fieldRow}>
            {FIELD_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={field === opt.value}
                onPress={() => {
                  setField(opt.value);
                  setError(null);
                }}
              />
            ))}
          </View>
          <AppTextInput
            value={note}
            onChangeText={(t) => setNote(t.slice(0, NOTE_MAX))}
            placeholder="Add details (optional)"
            multiline
            style={styles.note}
            accessibilityLabel="Report details, optional"
          />
          {error ? (
            <AppText variant="caption" color={colors.error} style={styles.error}>
              {error}
            </AppText>
          ) : null}
          <Button label="Submit report" onPress={() => void submit()} loading={submitting} disabled={!field} />
        </>
      )}
    </Sheet>
  );
}
