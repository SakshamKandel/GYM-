import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Card, enterUp } from '../../../components/ui';
import { getChallenge, type Challenge } from '../../../lib/api/social';
import { useAuth } from '../../../state/auth';

/**
 * Home entry point for the coach's monthly challenge.
 *
 * The challenge itself has always lived at the bottom of /leaderboard, and the
 * only way to /leaderboard is a row buried in Settings → Community. A member
 * could be enrolled in their coach's month and never once see it. This card
 * puts it on Home, next to the weekly check-in it belongs with, and hands off
 * to /leaderboard for the join button and progress bar so there is still one
 * place that owns the action.
 *
 * Renders nothing when there is no challenge — which is the common case, since
 * GET /api/challenges only answers for members with an active coach.
 *
 * Reads the challenge through lib/api/social, not the gamification feature:
 * feature modules never import each other.
 */

interface Props {
  stagger?: number;
}

export function CoachChallengeCard({ stagger = 0 }: Props) {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const [snapshot, setSnapshot] = useState<{ token: string; challenge: Challenge | null } | null>(
    null,
  );

  // Load on focus, like the check-in card above it. One cheap GET; the number
  // moves at most once a day, so there is nothing to poll.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'signedIn' || token === null) return;
      void (async () => {
        try {
          const challenge = await getChallenge(token);
          // A response that outlived its session belongs to nobody.
          if (useAuth.getState().token !== token) return;
          setSnapshot({ token, challenge });
        } catch {
          // Quiet: an entry point that can't load simply isn't shown.
        }
      })();
    }, [status, token]),
  );

  // Derive against the CURRENT session so a stale snapshot reads as "nothing".
  const challenge = snapshot !== null && snapshot.token === token ? snapshot.challenge : null;
  if (challenge === null) return null;

  const target = Math.max(0, Math.round(challenge.targetDays));
  const done = Math.max(0, Math.round(challenge.myDays));
  const line = challenge.complete
    ? 'Done. Badge earned.'
    : challenge.joined
      ? `${done} of ${target} training days`
      : `Join in. ${target} training days this month.`;
  const action = challenge.joined ? 'See how you are doing' : 'Open the challenge';

  return (
    <Animated.View entering={enterUp(stagger)} style={styles.wrap}>
      <Card
        onPress={() => router.push('/leaderboard' as Href)}
        accessibilityLabel={`Coach challenge: ${challenge.title}. ${line}. ${action}.`}
      >
        <View style={styles.press}>
          <View style={styles.iconChip}>
            <Ionicons
              name={challenge.complete ? 'ribbon' : 'ribbon-outline'}
              size={20}
              color={challenge.complete ? colors.success : colors.accent}
            />
          </View>
          <View style={styles.text}>
            <AppText variant="label" color={colors.textDim}>
              Coach challenge
            </AppText>
            <AppText variant="bodyBold" numberOfLines={2}>
              {challenge.title}
            </AppText>
            <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
              {line}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  press: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
});
