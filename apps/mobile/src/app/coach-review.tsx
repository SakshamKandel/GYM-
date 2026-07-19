import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  EmptyState,
  PressableScale,
  Screen,
  ScreenHeader,
} from '../components/ui';
import { BASE_URL } from '../lib/api/client';
import { successHaptic, warnHaptic } from '../lib/haptics';
import { useAuth } from '../state/auth';

/**
 * /coach-review?coachId&coachName — rate a current or former coach (Pack C /
 * L). New screen; talks to the new `POST /api/coaches/[id]/review` (also
 * new — WP-13's own contract addition, not owned by any other package's
 * `api/coach/**` tree). Upsert: re-submitting edits the caller's own review.
 */

const REQUEST_TIMEOUT_MS = 10_000;

type LoadState = 'loading' | 'ready' | 'error';
type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.starsRow} accessibilityRole="adjustable" accessibilityLabel={`Rating: ${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <PressableScale
          key={n}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
          onPress={() => onChange(n)}
          style={styles.starBtn}
        >
          <Ionicons
            name={n <= value ? 'star' : 'star-outline'}
            size={36}
            color={n <= value ? colors.accent : colors.textFaint}
          />
        </PressableScale>
      ))}
    </View>
  );
}

export default function CoachReviewScreen() {
  const { coachId, coachName } = useLocalSearchParams<{ coachId?: string; coachName?: string }>();
  const token = useAuth((s) => s.token);
  const name = coachName || 'your coach';

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  useEffect(() => {
    if (!token || typeof coachId !== 'string' || !coachId) {
      setLoadState('error');
      return;
    }
    let active = true;
    void (async () => {
      try {
        const res = await fetchWithTimeout(`${BASE_URL}/api/coaches/${encodeURIComponent(coachId)}/review`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('load_failed');
        const body = (await res.json()) as { review: { stars: number; note: string } | null };
        if (!active) return;
        if (body.review) {
          setStars(body.review.stars);
          setNote(body.review.note);
        }
        setLoadState('ready');
      } catch {
        if (active) setLoadState('ready'); // a fresh (unrated) form is still usable offline-first
      }
    })();
    return () => {
      active = false;
    };
  }, [token, coachId]);

  async function submit(): Promise<void> {
    if (!token || typeof coachId !== 'string' || !coachId || stars < 1 || submitState === 'submitting') return;
    setSubmitState('submitting');
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/coaches/${encodeURIComponent(coachId)}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ stars, note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error('submit_failed');
      successHaptic();
      setSubmitState('done');
    } catch {
      warnHaptic();
      setSubmitState('error');
    }
  }

  if (loadState === 'error' || typeof coachId !== 'string' || !coachId) {
    return (
      <Screen scroll>
        <ScreenHeader title="Rate your coach" />
        <EmptyState
          icon="alert-circle-outline"
          title="Can't rate this coach"
          body="Sign in and try again from your coach chat."
        />
      </Screen>
    );
  }

  if (submitState === 'done') {
    return (
      <Screen scroll>
        <ScreenHeader title="Rate your coach" />
        <EmptyState
          icon="checkmark-circle-outline"
          title="Thanks for the feedback"
          body={`Your rating for ${name} has been saved.`}
          actionLabel="Done"
          actionVariant="primary"
          onAction={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <ScreenHeader eyebrow="Coach feedback" title="Rate your coach" />
      <Card style={styles.card}>
        <AppText variant="bodyBold">{name}</AppText>
        <StarPicker value={stars} onChange={setStars} disabled={submitState === 'submitting'} />
        <AppTextInput
          value={note}
          onChangeText={setNote}
          editable={submitState !== 'submitting'}
          multiline
          maxLength={500}
          placeholder="What stood out about your coaching? (optional)"
          accessibilityLabel="Optional note about your coach"
          style={styles.noteInput}
        />
        {submitState === 'error' ? (
          <View accessibilityRole="alert">
            <AppText variant="body" color={colors.error}>
              Couldn&apos;t save your rating. Check your connection and try again.
            </AppText>
          </View>
        ) : null}
        <Button
          label={stars < 1 ? 'Pick a star rating' : 'Submit rating'}
          disabled={stars < 1 || submitState === 'submitting'}
          loading={submitState === 'submitting'}
          onPress={() => void submit()}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg, marginTop: spacing.lg },
  starsRow: { flexDirection: 'row', gap: spacing.sm },
  starBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteInput: { minHeight: 100, paddingTop: spacing.md, textAlignVertical: 'top' },
});
