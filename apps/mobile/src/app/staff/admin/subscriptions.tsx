import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  SectionLabel,
  Tag,
} from '../../../components/ui';
import {
  getAudit,
  getMembers,
  setTier,
  toStaffError,
  type AuditEntry,
  type MemberRow,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Subscriptions — override a member's tier and review recent overrides.
 *
 * Top: the member directory (getMembers) with a search box; each row shows the
 * member's current tier and opens a sheet to pick a new tier + optional reason,
 * committed via setTier(accountId, tier, reason). Bottom: the most recent tier
 * overrides pulled from the audit log filtered to `subscription.override`.
 * Every override refetches both the affected row's tier and the changes list.
 */

const TIERS: Tier[] = ['starter', 'silver', 'gold', 'elite'];

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

const TIER_COLOR: Record<Tier, string> = {
  starter: colors.textDim,
  silver: colors.blue,
  gold: colors.warning,
  elite: colors.accent,
};

const ERR_TEXT: Record<StaffErrorCode, string> = {
  unauthorized: 'Your session expired. Sign in again.',
  forbidden: "You don't have access to this.",
  not_found: 'Member not found.',
  invalid: "That didn't work.",
  conflict: 'That conflicts with the current state.',
  not_configured: 'This feature is not set up yet.',
  network: "Couldn't reach the server.",
};

function memberName(m: { displayName: string; email: string }): string {
  return m.displayName.trim() || m.email;
}

/** Compact relative time for the changes list. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Pull a target tier out of an audit meta blob, best-effort. */
function metaTier(meta: unknown): Tier | null {
  if (meta && typeof meta === 'object') {
    const rec = meta as Record<string, unknown>;
    const candidate = rec.tier ?? rec.to ?? rec.newTier;
    if (typeof candidate === 'string' && (TIERS as string[]).includes(candidate)) {
      return candidate as Tier;
    }
  }
  return null;
}

// ── Quiet retry line ──────────────────────────────────────────
function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onRetry}
      style={styles.retry}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption">{message} Tap to retry.</AppText>
    </PressableScale>
  );
}

// ════════════════════════════════════════════════════════════════
// Tier override sheet
// ════════════════════════════════════════════════════════════════

function OverrideSheet({
  member,
  token,
  onClose,
  onSaved,
}: {
  member: MemberRow;
  token: string;
  onClose: () => void;
  onSaved: (tier: Tier) => void;
}) {
  const [picked, setPicked] = useState<Tier>(member.tier);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = picked !== member.tier;

  async function save(): Promise<void> {
    if (!changed) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await setTier(member.id, picked, reason.trim() || undefined, token);
      onSaved(result.tier);
    } catch (e) {
      setError(ERR_TEXT[toStaffError(e).code]);
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(120)} style={styles.sheetRoot}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <Animated.View entering={enterUp(0)} style={styles.sheetCard}>
          <AppText variant="label">Override tier</AppText>
          <AppText variant="title" numberOfLines={1}>
            {memberName(member)}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            Currently {TIER_LABEL[member.tier]}
          </AppText>

          <View style={styles.tierGrid}>
            {TIERS.map((t) => {
              const on = picked === t;
              return (
                <PressableScale
                  key={t}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={TIER_LABEL[t]}
                  onPress={() => setPicked(t)}
                  style={[
                    styles.tierPill,
                    on && { borderColor: TIER_COLOR[t], backgroundColor: colors.surfaceRaised },
                  ]}
                >
                  <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[t] }]} />
                  <AppText
                    variant="bodyBold"
                    color={on ? colors.text : colors.textDim}
                    tabular={false}
                  >
                    {TIER_LABEL[t]}
                  </AppText>
                </PressableScale>
              );
            })}
          </View>

          <AppTextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional, audited)"
            style={styles.reasonInput}
            multiline
          />

          {error ? (
            <AppText variant="caption" color={colors.error}>
              {error}
            </AppText>
          ) : null}

          <View style={styles.sheetButtons}>
            <Button
              label="Cancel"
              variant="secondary"
              style={styles.sheetBtn}
              onPress={onClose}
            />
            <Button
              label={changed ? 'Apply' : 'No change'}
              style={styles.sheetBtn}
              onPress={() => void save()}
              disabled={saving || !changed}
              loading={saving}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// Screen
// ════════════════════════════════════════════════════════════════

export default function AdminSubscriptionsScreen() {
  const token = useAuth((s) => s.token);

  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [changes, setChanges] = useState<AuditEntry[]>([]);
  const [changesLoading, setChangesLoading] = useState(true);
  const [changesError, setChangesError] = useState<string | null>(null);

  const [editing, setEditing] = useState<MemberRow | null>(null);

  const loadMembers = useCallback(
    async (q: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setMembers(await getMembers(token, q.trim() || undefined));
      } catch (e) {
        setError(ERR_TEXT[toStaffError(e).code]);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const loadChanges = useCallback(async () => {
    if (!token) return;
    setChangesLoading(true);
    setChangesError(null);
    try {
      const page = await getAudit(token, { action: 'subscription.override' });
      setChanges(page.entries.slice(0, 12));
    } catch (e) {
      setChangesError(ERR_TEXT[toStaffError(e).code]);
    } finally {
      setChangesLoading(false);
    }
  }, [token]);

  // Debounced member search.
  useEffect(() => {
    const handle = setTimeout(() => void loadMembers(query), 300);
    return () => clearTimeout(handle);
  }, [query, loadMembers]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  function onSaved(tier: Tier): void {
    if (editing) {
      const id = editing.id;
      setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, tier } : m)));
    }
    setEditing(null);
    // The override was just written to the audit trail — refresh it.
    void loadChanges();
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else pushStaff(STAFF_ROUTES.adminHome);
  }

  return (
    <Screen scroll keyboardAware>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <AppText variant="heading">Subscriptions</AppText>
      </Animated.View>

      <AppTextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search members by email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void loadMembers(query)} />
        </View>
      ) : members.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          {query.trim() ? `No members match “${query.trim()}”.` : 'No members yet.'}
        </AppText>
      ) : (
        <View style={styles.list}>
          {members.map((m, i) => (
            <Animated.View key={m.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Override tier for ${memberName(m)}`}
                onPress={() => setEditing(m)}
                style={styles.memberRow}
              >
                <View style={styles.memberText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {memberName(m)}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {m.email}
                    {m.status === 'suspended' ? '  ·  suspended' : ''}
                  </AppText>
                </View>
                <View style={[styles.tierBadge, { borderColor: TIER_COLOR[m.tier] }]}>
                  <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[m.tier] }]} />
                  <AppText variant="label" color={colors.text}>
                    {TIER_LABEL[m.tier]}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      <SectionLabel>Recent overrides</SectionLabel>
      {changesLoading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.textDim} />
        </View>
      ) : changesError ? (
        <View style={styles.retryWrap}>
          <RetryLine message={changesError} onRetry={() => void loadChanges()} />
        </View>
      ) : changes.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No tier overrides recorded yet.
        </AppText>
      ) : (
        <View style={styles.changeList}>
          {changes.map((e) => {
            const tier = metaTier(e.meta);
            return (
              <View key={e.id} style={styles.changeRow}>
                <View style={styles.changeIcon}>
                  <Ionicons name="swap-horizontal" size={16} color={colors.accent} />
                </View>
                <View style={styles.changeText}>
                  <AppText variant="body" numberOfLines={1}>
                    {e.actorEmail ?? 'Someone'}
                    {tier ? ` → ${TIER_LABEL[tier]}` : ' changed a tier'}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {e.targetId ? `Member ${e.targetId.slice(0, 8)}` : e.targetType} ·{' '}
                    {timeAgo(e.createdAt)}
                  </AppText>
                </View>
                {tier ? <Tag label={TIER_LABEL[tier]} variant="outline" color={TIER_COLOR[tier]} /> : null}
              </View>
            );
          })}
        </View>
      )}

      {editing && token ? (
        <OverrideSheet
          member={editing}
          token={token}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      ) : null}
    </Screen>
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
  list: { gap: spacing.md, marginTop: spacing.lg },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  memberText: { flex: 1, gap: 2 },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tierDot: { width: 8, height: 8, borderRadius: radius.full },
  changeList: { gap: spacing.sm },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  changeIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeText: { flex: 1, gap: 2 },
  loadingBlock: { paddingVertical: spacing.xxl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyLine: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },

  // Sheet
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheetCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  tierGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    height: touch.min,
  },
  reasonInput: {
    marginTop: spacing.md,
    minHeight: 56,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  sheetButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  sheetBtn: { flex: 1 },
});
