import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, Sheet } from '../../../components/ui';
import { enquireGym, GymsApiError } from '../api';

/**
 * "Enquire about membership" lead-capture sheet (Pack M — fixes B15's
 * structural dead-end: there was no CTA after Call/Directions/Website). No
 * account of yours is queued or ticketed anywhere new — staff are pushed
 * immediately (see the route docblock) and this sheet's only job is to
 * confirm the message went somewhere real.
 */

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
  note: { marginBottom: spacing.lg, minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
  error: { marginBottom: spacing.md },
  successRow: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
});

export function EnquireSheet({ visible, onClose, gymSlug, gymName, token }: Props) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await enquireGym(gymSlug, message.trim() || undefined, token);
      setSubmitting(false);
      setSent(true);
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof GymsApiError && err.code === 'rate_limited'
          ? "You've sent a few of these already — try again later."
          : "Couldn't send your enquiry — check your connection and try again.",
      );
    }
  }

  function handleClose() {
    setMessage('');
    setSent(false);
    setError(null);
    onClose();
  }

  return (
    <Sheet visible={visible} onClose={handleClose} title={sent ? 'Sent!' : `Enquire about ${gymName}`}>
      {sent ? (
        <View style={styles.successRow}>
          <Ionicons name="checkmark-circle" size={48} color={colors.success} />
          <AppText variant="body" color={colors.textDim} style={{ textAlign: 'center' }}>
            Your enquiry is on its way to the team — they&apos;ll follow up on your account.
          </AppText>
          <Button label="Done" onPress={handleClose} />
        </View>
      ) : (
        <>
          <AppText variant="body" color={colors.textDim} style={styles.intro}>
            Ask about membership pricing, trial passes, or anything else — the team will reach out.
          </AppText>
          <AppTextInput
            value={message}
            onChangeText={(t) => setMessage(t.slice(0, NOTE_MAX))}
            placeholder="What would you like to know? (optional)"
            multiline
            style={styles.note}
            accessibilityLabel="Enquiry message, optional"
          />
          {error ? (
            <AppText variant="caption" color={colors.error} style={styles.error}>
              {error}
            </AppText>
          ) : null}
          <Button label="Send enquiry" onPress={() => void submit()} loading={submitting} />
        </>
      )}
    </Sheet>
  );
}
