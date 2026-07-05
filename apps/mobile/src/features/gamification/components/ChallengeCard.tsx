import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button } from '../../../components/ui';
import type { Challenge, ChallengeJoinErrorCode } from '../../../lib/api/social';

/**
 * Coach challenge card — surfaces the caller's active coach's monthly
 * challenge (threshold format, everyone reaching the target earns the badge;
 * no winner, no prizes, no ranking of members against each other). Opt-in
 * button, progress bar, and an earned state once complete. Display-only
 * beyond the join action — completion + the challenge badge are computed and
 * awarded server-side.
 */

interface Props {
  challenge: Challenge;
  onJoin: () => Promise<ChallengeJoinErrorCode | null>;
  onJoined: () => void;
}

function errorLine(code: ChallengeJoinErrorCode): string {
  switch (code) {
    case 'wrong_month':
      return "This challenge isn't active anymore.";
    case 'forbidden':
      return "You're not a client of this coach.";
    case 'not_found':
      return 'This challenge no longer exists.';
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    default:
      return "Can't join right now — try again in a bit.";
  }
}

export function ChallengeCard({ challenge, onJoin, onJoined }: Props) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ratio =
    challenge.targetDays > 0 ? Math.max(0, Math.min(1, challenge.myDays / challenge.targetDays)) : 0;

  async function handleJoin() {
    if (joining) return;
    setJoining(true);
    setError(null);
    const code = await onJoin();
    setJoining(false);
    if (code === null) {
      onJoined();
    } else {
      setError(errorLine(code));
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="ribbon-outline" size={18} color={colors.accent} />
        <View style={styles.headerText}>
          <AppText variant="title" numberOfLines={2}>
            {challenge.title}
          </AppText>
          <AppText variant="caption">
            From {challenge.coachName || 'your coach'} · {challenge.targetDays} session-days this month
          </AppText>
        </View>
      </View>

      {challenge.joined ? (
        <>
          <View style={styles.progressRow}>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${ratio * 100}%` }]} />
            </View>
            <AppText variant="caption" tabular>
              {challenge.myDays} of {challenge.targetDays}
            </AppText>
          </View>
          {challenge.complete ? (
            <View style={styles.completeRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <AppText variant="caption" color={colors.success}>
                Challenge complete — badge earned.
              </AppText>
            </View>
          ) : null}
        </>
      ) : (
        <Button
          label={joining ? 'Joining…' : 'Join challenge'}
          variant="primary"
          loading={joining}
          onPress={handleJoin}
          style={styles.joinBtn}
        />
      )}

      {error ? (
        <AppText variant="caption" color={colors.error} style={styles.errorText}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: radius.full, backgroundColor: colors.accent },
  completeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  joinBtn: { marginTop: 0 },
  errorText: { marginTop: -spacing.xs },
});
