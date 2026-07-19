import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, PressableScale, Sheet } from '../../../components/ui';
import { GymsApiError, submitGymReview } from '../api';

/**
 * Write/edit-review composer (Pack C write path — fixes B17). A 1-5 star
 * picker + optional note, submitted via `submitGymReview` (upsert — editing
 * an existing review is the same call). Errors are inline, never a silent
 * hang (hard-rule 5 spirit extended to this write path).
 */

const NOTE_MAX = 500;

interface Props {
  visible: boolean;
  onClose: () => void;
  gymSlug: string;
  gymName: string;
  token: string;
  /** Pre-fill when the member is editing their existing review. */
  initial?: { stars: number; note: string };
  onSubmitted: () => void;
}

const styles = StyleSheet.create({
  starsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  star: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { marginBottom: spacing.md, minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
  counter: { textAlign: 'right', marginBottom: spacing.lg },
  error: { marginBottom: spacing.md },
});

export function ReviewComposerSheet({ visible, onClose, gymSlug, gymName, token, initial, onSubmitted }: Props) {
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [note, setNote] = useState(initial?.note ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (stars < 1) {
      setError('Pick a star rating first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitGymReview(gymSlug, { stars, note: note.trim() || undefined }, token);
      setSubmitting(false);
      onSubmitted();
      onClose();
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof GymsApiError && err.code === 'rate_limited'
          ? "You're submitting too fast — try again shortly."
          : "Couldn't submit your review — check your connection and try again.",
      );
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={initial ? `Edit your review` : `Rate ${gymName}`}>
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <PressableScale
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${n} star${n === 1 ? '' : 's'}`}
            accessibilityState={{ selected: stars >= n }}
            onPress={() => {
              setStars(n);
              setError(null);
            }}
            style={styles.star}
          >
            <Ionicons name={stars >= n ? 'star' : 'star-outline'} size={30} color={colors.accent} />
          </PressableScale>
        ))}
      </View>

      <AppTextInput
        value={note}
        onChangeText={(t) => setNote(t.slice(0, NOTE_MAX))}
        placeholder="What stood out? (optional)"
        multiline
        style={styles.note}
        accessibilityLabel="Review note, optional"
      />
      <AppText variant="caption" color={colors.textFaint} style={styles.counter}>
        {note.length}/{NOTE_MAX}
      </AppText>

      {error ? (
        <AppText variant="caption" color={colors.error} style={styles.error}>
          {error}
        </AppText>
      ) : null}

      <Button
        label={initial ? 'Save changes' : 'Submit review'}
        onPress={() => void submit()}
        loading={submitting}
        disabled={stars < 1}
      />
    </Sheet>
  );
}
