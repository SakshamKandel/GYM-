import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { BADGE_CATALOG } from '@gym/shared';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  enterUp,
  layoutSpring,
  PressableScale,
  Screen,
  ScreenHeader,
  Tag,
} from '../../../components/ui';
import {
  decideCoachVerify,
  getCoachVerifyQueue,
  toStaffError,
  type StaffErrorCode,
  type VerifyItem,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Coach · Verify — the strength-badge verification queue, the phone twin of
 * the web `/coach/verify` `VerifyQueue`. Oldest-first, one tap per row
 * (idempotent `{action:'verify'}`); a success drops the row locally — no
 * refetch needed.
 */

const BADGE_NAME: Record<string, string> = Object.fromEntries(
  BADGE_CATALOG.map((b) => [b.id, b.name]),
);

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have coach access.";
  return "Couldn't load the verification queue.";
}

function rowErrorLine(code: StaffErrorCode): string {
  if (code === 'forbidden') return 'This client is no longer assigned to you.';
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  return "Couldn't verify this badge. Try again.";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function VerifyRow({
  item,
  index,
  busy,
  error,
  onVerify,
}: {
  item: VerifyItem;
  index: number;
  busy: boolean;
  error: string | null;
  onVerify: () => void;
}) {
  const badgeName = BADGE_NAME[item.badgeId] ?? item.badgeId;
  return (
    <Animated.View entering={enterUp(index)} layout={layoutSpring} style={styles.row}>
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
            {badgeName}
          </AppText>
          <Tag label="Logged" variant="outline" color={colors.blue} />
        </View>
        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
          {item.displayName || 'Member'} · {relativeTime(item.earnedAt)}
        </AppText>
        {error ? (
          <AppText variant="caption" color={colors.error}>
            {error}
          </AppText>
        ) : null}
      </View>
      <Button
        label={busy ? 'Verifying…' : 'Verify'}
        variant="secondary"
        loading={busy}
        disabled={busy}
        onPress={onVerify}
        style={styles.verifyBtn}
      />
    </Animated.View>
  );
}

export default function CoachVerifyScreen() {
  const token = useAuth((s) => s.token);

  const [items, setItems] = useState<VerifyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StaffErrorCode | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) {
      setError('unauthorized');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await getCoachVerifyQueue(token));
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

  const verify = useCallback(
    async (item: VerifyItem) => {
      if (!token || busyId) return;
      setBusyId(item.awardId);
      setRowErrors((prev) => {
        if (!(item.awardId in prev)) return prev;
        const next = { ...prev };
        delete next[item.awardId];
        return next;
      });
      try {
        await decideCoachVerify(item.awardId, token);
        successHaptic();
        setItems((prev) => prev.filter((i) => i.awardId !== item.awardId));
      } catch (err) {
        const code = toStaffError(err).code;
        if (code === 'not_found') {
          setItems((prev) => prev.filter((i) => i.awardId !== item.awardId));
        } else {
          setRowErrors((prev) => ({ ...prev, [item.awardId]: rowErrorLine(code) }));
        }
      } finally {
        setBusyId(null);
      }
    },
    [token, busyId],
  );

  return (
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

      <ScreenHeader
        eyebrow="Coach console"
        title="Verify"
        meta={
          items.length > 0 ? (
            <View style={styles.metaChip}>
              <AppText variant="label" color={colors.text}>
                {items.length} pending
              </AppText>
            </View>
          ) : undefined
        }
        style={styles.header}
      />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && items.length === 0 ? (
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
      ) : items.length === 0 ? (
        <View style={styles.centre}>
          <Ionicons name="ribbon-outline" size={32} color={colors.textFaint} />
          <AppText variant="title" center>
            Nothing to verify
          </AppText>
          <AppText variant="caption" center color={colors.textDim}>
            When a client logs a strength-club badge, it lands here for you to confirm.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item, i) => (
            <VerifyRow
              key={item.awardId}
              item={item}
              index={i}
              busy={busyId === item.awardId}
              error={rowErrors[item.awardId] ?? null}
              onVerify={() => void verify(item)}
            />
          ))}
        </View>
      )}
    </Screen>
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
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: { paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.md },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  rowText: { flex: 1, gap: 3, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1 },
  verifyBtn: { minHeight: touch.min, paddingHorizontal: spacing.lg },
});
