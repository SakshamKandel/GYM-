import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, PressableScale } from '../../../components/ui';
import { rateMealOrder, toMealsError } from '../api';
import { mealErrorMessage } from '../logic';
import { successHaptic, warnHaptic } from '../../../lib/haptics';

/**
 * Post-delivery star rating (Pack C). Only ever rendered for a `delivered`
 * order; the server additionally enforces ownership + delivered + one-per-order
 * (a second submit 409s `already_rated`, surfaced via the normal error line).
 */

const STARS = [1, 2, 3, 4, 5];

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  starBtn: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
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

export function RatingPanel({ token, orderId, onDone }: Props) {
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(): void {
    if (stars < 1 || submitting) return;
    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        await rateMealOrder(token, orderId, { stars, note: note.trim() || undefined });
        successHaptic();
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
        <AppText variant="bodyBold">Thanks for rating your order</AppText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <AppText variant="body" color={colors.textDim}>
        How was this order?
      </AppText>
      <View style={styles.starsRow} accessibilityRole="adjustable" accessibilityLabel={`${stars} of 5 stars`}>
        {STARS.map((s) => (
          <PressableScale
            key={s}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${s} star${s === 1 ? '' : 's'}`}
            onPress={() => setStars(s)}
            style={styles.starBtn}
          >
            <Ionicons name={s <= stars ? 'star' : 'star-outline'} size={30} color={colors.accent} />
          </PressableScale>
        ))}
      </View>
      <AppTextInput
        value={note}
        onChangeText={setNote}
        placeholder="Add a note (optional)"
        accessibilityLabel="Rating note"
        multiline
      />
      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}
      <Button label="Submit rating" onPress={submit} disabled={stars < 1} loading={submitting} />
    </View>
  );
}
