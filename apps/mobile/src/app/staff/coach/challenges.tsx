import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Divider,
  enterDown,
  enterUp,
  layoutSpring,
  PressableScale,
  ProgressBar,
  Screen,
  ScreenHeader,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  toStaffError,
  upsertCoachChallenge,
  listCoachChallenges,
  type CoachChallenge,
  type CoachChallengeMember,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Challenges — the coach's monthly challenge + per-client progress,
 * the phone twin of the web `/coach/challenges` `ChallengeManager` (minus
 * Coach's pick — that spotlight flow has no mobile client function yet, so
 * this screen sticks to what `features/staff/api.ts` exposes: list + create).
 *
 * ONE active challenge per coach per month — create-only, there is no edit
 * route, so the create form lives in a Sheet that only ever appears when no
 * challenge exists yet for the current month. A 409 `exists` (another tab, or
 * a race) just reloads the real state instead of erroring.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return `${MONTH_NAMES[m - 1] ?? m} ${y}`;
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load your challenge.";
}

function createErrorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'invalid') return 'Check the title and target, then try again.';
  return "Couldn't create the challenge. Try again.";
}

function MemberRow({ member, targetDays }: { member: CoachChallengeMember; targetDays: number }) {
  return (
    <View style={styles.memberRow}>
      <View style={styles.memberTop}>
        <AppText variant="body" numberOfLines={1} style={styles.memberName}>
          {member.displayName || 'Member'}
        </AppText>
        {!member.joined ? (
          <Tag label="Not joined" variant="outline" color={colors.textFaint} />
        ) : member.complete ? (
          <Tag label="Complete" variant="outline" color={colors.success} />
        ) : (
          <AppText variant="caption" color={colors.textDim} tabular>
            {member.days} / {targetDays}
          </AppText>
        )}
      </View>
      {member.joined ? (
        <ProgressBar
          value={targetDays > 0 ? member.days / targetDays : 0}
          height={6}
          fillColor={member.complete ? colors.success : colors.accent}
        />
      ) : null}
    </View>
  );
}

export default function CoachChallengesScreen() {
  const token = useAuth((s) => s.token);

  const [challenge, setChallenge] = useState<CoachChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StaffErrorCode | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [targetDays, setTargetDays] = useState('12');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('unauthorized');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setChallenge(await listCoachChallenges(token));
      setError(null);
    } catch (err) {
      setError(toStaffError(err).code);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = useCallback(() => {
    setTitle('');
    setTargetDays('12');
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const submitCreate = useCallback(async () => {
    if (!token || creating) return;
    const trimmedTitle = title.trim();
    const target = Number.parseInt(targetDays, 10);
    if (trimmedTitle.length === 0 || trimmedTitle.length > 80) {
      setCreateError('Enter a title up to 80 characters.');
      return;
    }
    if (!Number.isFinite(target) || target < 4 || target > 31) {
      setCreateError('Enter a target between 4 and 31 session-days.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await upsertCoachChallenge(
        { title: trimmedTitle, targetDays: target, monthKey: currentMonthKey() },
        token,
      );
      successHaptic();
      setCreateOpen(false);
      await load();
    } catch (err) {
      const code = toStaffError(err).code;
      if (code === 'conflict') {
        // Already created (another tab, or a race) — reload the real state.
        setCreateOpen(false);
        await load();
      } else {
        setCreateError(createErrorLine(code));
      }
    } finally {
      setCreating(false);
    }
  }, [token, creating, title, targetDays, load]);

  return (
    <>
      <Screen scroll>
        <Animated.View entering={enterDown()} style={styles.backRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Back to coach console"
            onPress={() => pushStaff(STAFF_ROUTES.coachInbox)}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>

        <ScreenHeader eyebrow="Coach console" title="Challenges" style={styles.header} />

        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && !challenge ? (
          <View style={styles.centre}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.textFaint} />
            <AppText variant="caption" center color={colors.textDim}>
              {errorLine(error)}
            </AppText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Retry"
              onPress={() => void load()}
              style={styles.retryBtn}
            >
              <AppText variant="label" color={colors.accent}>
                Tap to retry
              </AppText>
            </PressableScale>
          </View>
        ) : challenge ? (
          <Animated.View entering={enterUp(0)} layout={layoutSpring} style={styles.card}>
            <View style={styles.cardTop}>
              <AppText variant="title" numberOfLines={2} style={styles.challengeTitle}>
                {challenge.title}
              </AppText>
            </View>
            <AppText variant="caption" color={colors.textDim} tabular>
              {monthLabel(challenge.monthKey)} · target {challenge.targetDays} session-days
            </AppText>

            <Divider />

            {challenge.members.length === 0 ? (
              <AppText variant="caption" color={colors.textDim}>
                No clients are assigned to you yet.
              </AppText>
            ) : (
              <View style={styles.memberList}>
                {challenge.members.map((m) => (
                  <MemberRow key={m.userId} member={m} targetDays={challenge.targetDays} />
                ))}
              </View>
            )}
          </Animated.View>
        ) : (
          <Animated.View entering={enterUp(0)} style={styles.emptyCard}>
            <Ionicons name="trophy-outline" size={28} color={colors.textFaint} />
            <AppText variant="title" center>
              No challenge yet
            </AppText>
            <AppText variant="caption" center color={colors.textDim}>
              Create one for {monthLabel(currentMonthKey())} — every client who reaches the
              target session-day count earns the badge. No winner, no ranking.
            </AppText>
            <Button label="Create challenge" onPress={openCreate} style={styles.createBtn} />
          </Animated.View>
        )}

        {challenge ? (
          <Button
            label="Refresh"
            variant="ghost"
            onPress={() => void load()}
            style={styles.refreshBtn}
          />
        ) : null}
      </Screen>

      <Sheet
        visible={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Create this month's challenge"
      >
        <View style={styles.sheetBody}>
          <AppText variant="label">Title</AppText>
          <AppTextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. 12 sessions this month"
            maxLength={80}
            accessibilityLabel="Challenge title"
          />
          <AppText variant="label">Target session-days (4–31)</AppText>
          <AppTextInput
            value={targetDays}
            onChangeText={setTargetDays}
            keyboardType="number-pad"
            placeholder="12"
            accessibilityLabel="Target session-days"
          />
          {createError ? (
            <AppText variant="caption" color={colors.error}>
              {createError}
            </AppText>
          ) : null}
          <Button
            label={creating ? 'Creating…' : 'Create challenge'}
            loading={creating}
            disabled={creating || title.trim().length === 0}
            onPress={() => void submitCreate()}
            style={styles.sheetSave}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  centre: { paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.md },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  challengeTitle: { flex: 1 },
  memberList: { gap: spacing.md },
  memberRow: { gap: spacing.xs },
  memberTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  memberName: { flexShrink: 1 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    alignItems: 'center',
    gap: spacing.sm,
  },
  createBtn: { marginTop: spacing.md, alignSelf: 'stretch' },
  refreshBtn: { marginTop: spacing.lg },
  sheetBody: { gap: spacing.sm, paddingBottom: spacing.md },
  sheetSave: { marginTop: spacing.md },
});
