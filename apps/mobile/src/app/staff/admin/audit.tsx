import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  Tag,
} from '../../../components/ui';
import {
  getAudit,
  type AuditEntry,
  toStaffError,
} from '../../../features/staff/api';
import { isTopAdmin, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Audit trail (super_admin + main_admin).
 *
 * Keyset-paginated audit log (getAudit) — newest first, showing time, actor,
 * action and target. A row of quick action filters narrows the feed; the raw
 * filter re-runs from page one. "Load more" appends the next cursor page.
 * Gated: sub-roles see a locked notice, never the data.
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader → pill filter chips →
 * charcoal entry rows separated by gaps (no hairline dividers, no borders).
 */

/** Common audit actions surfaced as one-tap filter chips (server free-text). */
const ACTION_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'member', label: 'Members' },
  { key: 'coach', label: 'Coaches' },
  { key: 'assignment', label: 'Assignments' },
  { key: 'video', label: 'Videos' },
  { key: 'staff', label: 'Staff' },
  { key: 'subscription', label: 'Tiers' },
];

/** Short relative time ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

/** Turn "member.tier.override" into "Member tier override". */
function humanAction(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim();
  if (!words) return action;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function AuditScreen() {
  const token = useAuth((s) => s.token);
  const staffRole = useAuth((s) => s.staffRole);
  const canViewAudit = isTopAdmin(staffRole);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Load page one for the current filter (replaces the list). */
  const load = useCallback(
    async (action: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const page = await getAudit(token, action ? { action } : {});
        setEntries(page.entries);
        setCursor(page.nextCursor);
      } catch (err) {
        setError(toStaffError(err).code);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  /** Append the next keyset page. */
  const loadMore = useCallback(async () => {
    if (!token || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getAudit(token, {
        cursor,
        ...(filter ? { action: filter } : {}),
      });
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(toStaffError(err).code);
    } finally {
      setLoadingMore(false);
    }
  }, [token, cursor, filter, loadingMore]);

  useEffect(() => {
    if (canViewAudit) void load('');
  }, [canViewAudit, load]);

  function pickFilter(action: string): void {
    setFilter(action);
    void load(action);
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.hub);
  }

  if (!canViewAudit) {
    return (
      <Screen>
        <BackRow title="Audit trail" onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can view the audit trail.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow title="Audit trail" onBack={goBack} />

      <Animated.View entering={enterDown()} style={styles.filterRow}>
        {ACTION_FILTERS.map((f) => (
          <Chip
            key={f.key || 'all'}
            label={f.label}
            selected={filter === f.key}
            onPress={() => pickFilter(f.key)}
          />
        ))}
      </Animated.View>

      {loading && entries.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {error && entries.length === 0 ? (
        <RetryLine
          label="Couldn't load the audit trail"
          onRetry={() => void load(filter)}
        />
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
          No audit entries for this filter.
        </AppText>
      ) : null}

      {entries.map((e, i) => (
        <Animated.View key={e.id} entering={enterUp(Math.min(i, 6))}>
          <View style={styles.entry}>
            <View style={styles.entryHead}>
              <Tag label={humanAction(e.action)} variant="dim" />
              <AppText variant="caption" color={colors.textFaint}>
                {relativeTime(e.createdAt)}
              </AppText>
            </View>
            <AppText variant="body" numberOfLines={1}>
              {e.actorEmail ?? 'System / deleted actor'}
            </AppText>
            <AppText variant="caption" numberOfLines={1}>
              {e.targetType}
              {e.targetId ? ` · ${e.targetId}` : ''}
            </AppText>
          </View>
        </Animated.View>
      ))}

      {error && entries.length > 0 ? (
        <RetryLine label="Couldn't load more" onRetry={() => void loadMore()} />
      ) : null}

      {cursor && !error ? (
        <Button
          label="Load more"
          variant="secondary"
          onPress={() => void loadMore()}
          loading={loadingMore}
          style={styles.loadMore}
        />
      ) : null}
    </Screen>
  );
}

/** Shared back row + revamp header (no native header — matches the app). */
function BackRow({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader eyebrow="Admin console" title={title} style={styles.header} />
    </>
  );
}

/** Quiet inline retry line for a failed fetch. */
function RetryLine({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to retry.`}
      onPress={onRetry}
      style={styles.retryLine}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption" color={colors.textDim}>
        {label} · tap to retry
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  hint: { marginTop: spacing.md },
  // Charcoal entry row (brief §11c): gaps between rows replace hairlines.
  entry: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
    marginBottom: spacing.sm,
  },
  entryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  retryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadMore: { marginTop: spacing.lg },
});
