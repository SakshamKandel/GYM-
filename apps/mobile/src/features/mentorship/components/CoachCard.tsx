import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, PressableScale, Tag } from '../../../components/ui';
import type { CoachCardData } from '../api';
import { pushPath } from '../nav';
import { CoachAvatar } from './CoachAvatar';
import { CoachTierBadge } from './CoachTierBadge';

/**
 * One coach in the discovery hub — a charcoal row card (block language:
 * borderless, separation by fill contrast): 56dp photo-or-initials avatar,
 * name + seniority badge, one-line headline, a star line once real members
 * have rated the coach, up to three specialty pills (+N overflow), and a
 * right rail with availability + a live client count (the capacity signal
 * the list payload exposes). The whole row taps through to the coach's
 * profile.
 *
 * The star line is entirely optional: the server withholds `rating` until a
 * coach has enough genuine reviews, and older servers omit the field, so a
 * missing/null aggregate simply renders nothing (never "0.0" or a zero-star
 * row that would read as a bad review).
 */

const AVATAR = 56;
const MAX_SPECIALTIES = 3;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 88,
  },
  main: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nameText: { flexShrink: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  specialties: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  rail: { flexShrink: 0, alignItems: 'flex-end', gap: spacing.xs },
});

export function CoachCard({ coach }: { coach: CoachCardData }) {
  const accepting = coach.acceptingClients && coach.hasCapacity;
  const shown = coach.specialties.slice(0, MAX_SPECIALTIES);
  const overflow = coach.specialties.length - shown.length;

  // `rating` is optional AND nullable — only a real number counts as a rating.
  const rating = typeof coach.rating === 'number' ? coach.rating : null;
  const reviewCount = typeof coach.reviewCount === 'number' ? coach.reviewCount : null;
  const ratingLabel =
    rating === null
      ? ''
      : `Rated ${rating.toFixed(1)} out of 5${
          reviewCount !== null
            ? ` from ${reviewCount} review${reviewCount === 1 ? '' : 's'}`
            : ''
        }. `;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${coach.displayName}, ${coach.coachTier} coach. ${coach.headline}. ${
        ratingLabel}${
        coach.activeClients} active client${coach.activeClients === 1 ? '' : 's'}. ${
        accepting ? 'Accepting clients' : 'Not taking clients'
      }. View profile`}
      onPress={() => pushPath(`/coaches/${coach.id}`)}
      style={styles.row}
    >
      <CoachAvatar
        name={coach.displayName}
        url={coach.photoUrl ?? coach.avatarUrl}
        size={AVATAR}
      />

      <View style={styles.main}>
        <View style={styles.nameRow}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.nameText}>
            {coach.displayName}
          </AppText>
          <CoachTierBadge tier={coach.coachTier} />
        </View>
        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
          {coach.headline}
        </AppText>
        {/* The card's own accessibilityLabel already reads the rating aloud —
            this row is the visual half only (same as the headline/specialties). */}
        {rating !== null ? (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color={colors.accent} />
            <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
              {rating.toFixed(1)}
              {reviewCount !== null ? ` (${reviewCount})` : ''}
            </AppText>
          </View>
        ) : null}
        {shown.length > 0 ? (
          <View style={styles.specialties}>
            {shown.map((s) => (
              <Tag key={s} label={s} variant="dim" />
            ))}
            {overflow > 0 ? <Tag label={`+${overflow}`} variant="dim" /> : null}
          </View>
        ) : null}
      </View>

      <View style={styles.rail}>
        {accepting ? (
          <Tag label="Accepting" variant="outline" color={colors.success} />
        ) : (
          <Tag label="Full" variant="dim" />
        )}
        <AppText variant="label" numberOfLines={1}>
          {coach.activeClients} client{coach.activeClients === 1 ? '' : 's'}
        </AppText>
      </View>
    </PressableScale>
  );
}
