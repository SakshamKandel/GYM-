import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, Sheet } from '../../../components/ui';
import { enquireGym, GymsApiError } from '../api';

/**
 * "Enquire about membership" lead-capture sheet (Pack M — fixes B15's
 * structural dead-end: there was no CTA after Call/Directions/Website). The
 * enquiry is stored and staff are pushed immediately (see the route docblock),
 * and this sheet's only job is to confirm the message went somewhere real.
 *
 * COPY BOUNDARY: it used to promise "the team will reach out" and "they'll
 * follow up on your account". Neither is guaranteed. Staff work the leads in
 * the admin queue and mark them contacted, but nothing sends the member a
 * reply, and there is no member-facing read of the enquiry — so the app cannot
 * show its state and must not imply someone is on their way. What IS certain:
 * the message is saved and staff see it. That is what we say, plus the one
 * thing the member can do right now if they need an answer today. When a
 * member-visible enquiry state exists, this copy should grow back into a
 * promise (see the followups).
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
  centered: { textAlign: 'center' },
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
          ? "You've sent a few of these already. Try again later."
          : "Couldn't send your enquiry. Check your connection and try again.",
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
          <AppText variant="body" color={colors.textDim} style={styles.centered}>
            Your question is saved and the team can see it. Replies don&apos;t come back into the
            app yet, so if you need an answer today, try the contact details on the {gymName} page.
          </AppText>
          <Button label="Done" onPress={handleClose} />
        </View>
      ) : (
        <>
          <AppText variant="body" color={colors.textDim} style={styles.intro}>
            Ask about membership pricing, trial passes, or anything else. Your question goes to the
            team who look after this listing.
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
