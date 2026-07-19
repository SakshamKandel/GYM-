import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, Card, Divider, SectionLabel, Skeleton } from '../../../components/ui';
import { useGymReviews } from '../hooks';
import { ReviewComposerSheet } from './ReviewComposerSheet';

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  row: { paddingVertical: spacing.md },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  starsRow: { flexDirection: 'row', gap: 2 },
  note: { marginTop: spacing.xs },
  meta: { marginTop: spacing.xs },
  skeletons: { gap: spacing.sm },
  empty: { paddingVertical: spacing.md },
});

function StarRow({ stars }: { stars: number }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={stars >= n ? 'star' : 'star-outline'} size={14} color={colors.accent} />
      ))}
    </View>
  );
}

/**
 * Reviews section on the gym detail page (Pack C write path — fixes B17: a
 * rating was rendered as social proof with no member write path anywhere).
 * Reads the real `gym_reviews` aggregate the detail/list routes already
 * gate their `rating`/`reviewCount` display on; writing here is what makes
 * that number genuine going forward.
 *
 * Known scope limit: "Write a review" always opens blank (it doesn't
 * pre-fetch the caller's own prior review to pre-fill an edit) — a repeat
 * submission still correctly EDITS the member's existing row server-side
 * (upsert), it just re-starts the star picker at zero rather than showing
 * what was there before. Acceptable for v1.1; a `GET …/reviews/mine` route
 * would remove this if a future pass wants it.
 */
export function GymReviewsSection({
  gymSlug,
  gymName,
  isSignedIn,
  token,
}: {
  gymSlug: string;
  gymName: string;
  isSignedIn: boolean;
  token: string | null;
}) {
  const { reviews, loading, error, refresh } = useGymReviews(gymSlug);
  const [composerOpen, setComposerOpen] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  return (
    <View>
      <View style={styles.header}>
        <SectionLabel>Reviews</SectionLabel>
        {isSignedIn && token ? (
          <Button
            label={justSubmitted ? 'Edit your review' : 'Write a review'}
            variant="secondary"
            onPress={() => setComposerOpen(true)}
          />
        ) : null}
      </View>

      <Card padding={spacing.lg}>
        {loading ? (
          <View style={styles.skeletons}>
            <Skeleton height={48} />
            <Skeleton height={48} />
          </View>
        ) : error ? (
          <AppText variant="body" color={colors.textDim}>
            Couldn&apos;t load reviews right now.
          </AppText>
        ) : reviews.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="body" color={colors.textDim}>
              No reviews yet — be the first to share how this gym is.
            </AppText>
          </View>
        ) : (
          reviews.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <View style={styles.rowHead}>
                  <AppText variant="bodyBold">{r.authorName}</AppText>
                  <StarRow stars={r.stars} />
                </View>
                {r.note ? (
                  <AppText variant="body" color={colors.textDim} style={styles.note}>
                    {r.note}
                  </AppText>
                ) : null}
                <AppText variant="caption" color={colors.textFaint} style={styles.meta}>
                  {DATE_FMT.format(new Date(r.createdAt))}
                </AppText>
              </View>
            </View>
          ))
        )}
      </Card>

      {isSignedIn && token ? (
        <ReviewComposerSheet
          visible={composerOpen}
          onClose={() => setComposerOpen(false)}
          gymSlug={gymSlug}
          gymName={gymName}
          token={token}
          onSubmitted={() => {
            setJustSubmitted(true);
            refresh();
          }}
        />
      ) : null}
    </View>
  );
}
