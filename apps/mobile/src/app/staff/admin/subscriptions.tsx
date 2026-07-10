import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Stepper,
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
import {
  defaultCustomDateParts,
  DURATION_OPTIONS,
  expiresAtFor,
  expiryLabel,
  isoFromDateParts,
  tierAllowsExpiry,
  type DurationChoice,
} from '../../../features/staff/duration';
import { pushStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Subscriptions — override a member's tier + expiry and review recent
 * overrides.
 *
 * Top: the member directory (getMembers) with a search box; each row shows the
 * member's current tier and opens a sheet to pick a new tier, a duration
 * (30 / 90 days · 1 year · permanent · custom date) and an optional reason,
 * committed via setTier(accountId, tier, reason, { expiresAt }). Bottom: the
 * most recent tier overrides pulled from the audit log filtered to
 * `subscription.override` — whose meta also carries the expiry we surface as
 * each member's current window. Every override refetches both the affected
 * row's tier and the changes list.
 *
 * Block language (REVAMP-BRIEF): back row → ScreenHeader → charcoal member
 * rows (no borders; tier pills keep their strokes — chips may carry borders) →
 * charcoal override-history rows. The override sheet is a borderless charcoal
 * panel with chunky block corners.
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
  insufficient_rank: 'Only a higher admin can do that.',
  not_found: 'Member not found.',
  invalid: "That didn't work.",
  cannot_target_self: "You can't change your own role.",
  cannot_revoke_self: "You can't revoke your own access.",
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

/**
 * The expiry window an override recorded, from its audit meta. The server logs
 * `{ tier, reason, startsAt?, expiresAt? }` as ISO strings or null. Three-way
 * result:
 *   - `undefined` → the meta didn't carry an expiresAt (older override / not set)
 *   - `null`      → set permanent (no expiry)
 *   - string      → the ISO expiry instant
 */
function metaExpiresAt(meta: unknown): string | null | undefined {
  if (meta && typeof meta === 'object' && 'expiresAt' in meta) {
    const v = (meta as Record<string, unknown>).expiresAt;
    if (v === null) return null;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/**
 * Best-effort current expiry for a member: the expiresAt from the most-recent
 * `subscription.override` audit entry that targeted them AND carried the field.
 * Entries arrive newest-first, so the first match wins. `undefined` = unknown.
 */
function latestExpiryFor(memberId: string, entries: AuditEntry[]): string | null | undefined {
  for (const e of entries) {
    if (e.targetId !== memberId) continue;
    const exp = metaExpiresAt(e.meta);
    if (exp !== undefined) return exp;
  }
  return undefined;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Clamp a day to the days in the given month/year (no Feb 30). */
function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
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
  currentExpiry,
  token,
  onClose,
  onSaved,
}: {
  member: MemberRow;
  /** Best-effort current expiry: undefined = unknown, null = permanent, ISO = set. */
  currentExpiry: string | null | undefined;
  token: string;
  onClose: () => void;
  onSaved: (tier: Tier) => void;
}) {
  const [picked, setPicked] = useState<Tier>(member.tier);
  // The window the operator wants. `null` (permanent) is the safe default so a
  // plain tier bump doesn't silently attach an expiry; touching a duration chip
  // opts into a dated window.
  const [duration, setDuration] = useState<DurationChoice>('permanent');
  const [windowTouched, setWindowTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom date parts default ~90 days out. Lazy initializers read the clock
  // once at mount (never during render — React purity).
  const [year, setYear] = useState(() => defaultCustomDateParts().year);
  const [month, setMonth] = useState(() => defaultCustomDateParts().month);
  const [day, setDay] = useState(() => defaultCustomDateParts().day);

  const allowsExpiry = tierAllowsExpiry(picked);
  const usingCustom = allowsExpiry && duration === 'custom';
  const maxDay = daysInMonth(year, month);
  const safeDay = Math.min(day, maxDay);

  // Resolve the picked window to an ISO expiry (or null = permanent).
  const resolvedExpiresAt = useMemo((): string | null => {
    if (!allowsExpiry) return null; // starter → permanent
    const option = DURATION_OPTIONS.find((o) => o.key === duration);
    if (!option) return null;
    if (duration === 'custom') return isoFromDateParts(year, month, safeDay);
    return expiresAtFor(option) ?? null;
  }, [allowsExpiry, duration, year, month, safeDay]);

  const tierChanged = picked !== member.tier;
  // "Dirty" when the tier changed OR the operator chose a window (extend/renew
  // without a tier change is a valid override).
  const dirty = tierChanged || windowTouched;

  function chooseTier(t: Tier): void {
    setPicked(t);
    // Starter can't carry an expiry — snap the window back to permanent.
    if (!tierAllowsExpiry(t)) {
      setDuration('permanent');
    }
  }

  function chooseDuration(key: DurationChoice): void {
    setDuration(key);
    setWindowTouched(true);
  }

  async function save(): Promise<void> {
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await setTier(
        member.id,
        picked,
        reason.trim() || undefined,
        // Only send expiresAt when the operator set a window (or the tier is
        // starter, which must be permanent). Otherwise omit it so a plain tier
        // bump leaves the existing expiry column untouched.
        windowTouched || !allowsExpiry ? { expiresAt: allowsExpiry ? resolvedExpiresAt : null } : undefined,
        token,
      );
      onSaved(result.tier);
    } catch (e) {
      setError(ERR_TEXT[toStaffError(e).code]);
      setSaving(false);
    }
  }

  const previewLine = !allowsExpiry
    ? 'Permanent (free tier)'
    : windowTouched
      ? expiryLabel(resolvedExpiresAt)
      : 'Expiry unchanged';

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
            {currentExpiry !== undefined ? ` · ${expiryLabel(currentExpiry)}` : ''}
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
                  onPress={() => chooseTier(t)}
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

          {allowsExpiry ? (
            <>
              <AppText variant="label" style={styles.durationLabel}>
                Duration
              </AppText>
              <View style={styles.durationGrid}>
                {DURATION_OPTIONS.map((opt) => {
                  const on = windowTouched && duration === opt.key;
                  return (
                    <PressableScale
                      key={opt.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={opt.label}
                      onPress={() => chooseDuration(opt.key)}
                      style={[styles.durationPill, on && styles.durationPillOn]}
                    >
                      <AppText
                        variant="body"
                        color={on ? colors.text : colors.textDim}
                        tabular={false}
                      >
                        {opt.label}
                      </AppText>
                    </PressableScale>
                  );
                })}
              </View>

              {usingCustom ? (
                <View style={styles.stepperRow}>
                  <Stepper
                    label="Year"
                    value={year}
                    onChange={setYear}
                    step={1}
                    min={new Date().getFullYear()}
                    max={new Date().getFullYear() + 5}
                  />
                  <Stepper
                    label="Month"
                    value={month}
                    onChange={setMonth}
                    step={1}
                    min={1}
                    max={12}
                    format={(v) => MONTHS[Math.min(Math.max(v, 1), 12) - 1] ?? String(v)}
                  />
                  <Stepper
                    label="Day"
                    value={safeDay}
                    onChange={setDay}
                    step={1}
                    min={1}
                    max={maxDay}
                  />
                </View>
              ) : null}
            </>
          ) : null}

          <View style={styles.previewRow}>
            <Ionicons
              name={allowsExpiry && windowTouched ? 'calendar-outline' : 'infinite-outline'}
              size={15}
              color={colors.accent}
            />
            <AppText variant="caption" color={colors.text}>
              {previewLine}
            </AppText>
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
              label={dirty ? 'Apply' : 'No change'}
              style={styles.sheetBtn}
              onPress={() => void save()}
              disabled={saving || !dirty}
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
      </Animated.View>

      <ScreenHeader eyebrow="Admin console" title="Subscriptions" style={styles.header} />

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
                <IconChip icon="swap-horizontal" size={34} iconColor={colors.accent} />
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
          currentExpiry={latestExpiryFor(editing.id, changes)}
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
  header: { marginBottom: spacing.gutter },
  list: { gap: spacing.md, marginTop: spacing.lg },
  // Charcoal member row (brief §11c): fill contrast, no hairline borders.
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 64,
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
  // Override-history rows: charcoal cards, gaps instead of hairlines.
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
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
  // Borderless charcoal panel with block corners (no-border card law).
  sheetCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.block,
    borderTopRightRadius: radius.block,
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
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    height: touch.min,
  },
  durationLabel: { marginTop: spacing.md },
  durationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  durationPill: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationPillOn: { borderColor: colors.text, backgroundColor: colors.surfaceRaised },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
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
