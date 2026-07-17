import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  Stepper,
} from '../../../components/ui';
import {
  createPromoCode,
  getAdminPromoCodes,
  getCoaches,
  updatePromoCode,
  toStaffError,
  type CoachRow,
  type PromoCodeRow,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { DURATION_OPTIONS, expiresAtFor, expiryLabel, type DurationChoice } from '../../../features/staff/duration';
import { canManagePromos, replaceStaff, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Promo codes — house codes + the auto-issued coach codes
 * (SCALE-UP-PLAN §1.3 / §4.1). super_admin + main_admin only (the hub already
 * filters this row; this screen re-gates in case of a direct deep link).
 *
 * List: every code with its owner (a coach's promo, or "House code"),
 * discount/commission split, redemption count, active state (tap the switch
 * to toggle — PATCH active). "New code" opens a create sheet: an optional
 * explicit code (blank = server auto-generates), an optional owning coach
 * (search the coach roster), discount/commission steppers, an optional
 * redemption cap, and an expiry window (permanent or a day-count preset —
 * the same duration presets the tier-override screen uses, minus the custom
 * date picker for this v1).
 */

const NON_CUSTOM_DURATIONS = DURATION_OPTIONS.filter((o) => o.key !== 'custom');

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'conflict') return 'That code already exists — try another.';
  if (code === 'invalid') return "Some details were rejected. Check the fields and try again.";
  return "Couldn't load promo codes.";
}

function coachDisplay(c: CoachRow): string {
  return c.coachName?.trim() || c.displayName.trim() || c.email;
}

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
// Create sheet
// ════════════════════════════════════════════════════════════════

function CreateSheet({
  visible,
  coaches,
  token,
  onClose,
  onCreated,
}: {
  visible: boolean;
  coaches: CoachRow[];
  token: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [ownerQuery, setOwnerQuery] = useState('');
  const [owner, setOwner] = useState<CoachRow | null>(null);
  const [discountPct, setDiscountPct] = useState(20);
  const [commissionPct, setCommissionPct] = useState(0);
  const [capped, setCapped] = useState(false);
  const [maxRedemptions, setMaxRedemptions] = useState(100);
  const [duration, setDuration] = useState<DurationChoice>('permanent');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerResults = useMemo(() => {
    const q = ownerQuery.trim().toLowerCase();
    if (!q || owner) return [];
    return coaches.filter((c) => coachDisplay(c).toLowerCase().includes(q)).slice(0, 6);
  }, [ownerQuery, owner, coaches]);

  function reset(): void {
    setCode('');
    setOwnerQuery('');
    setOwner(null);
    setDiscountPct(20);
    setCommissionPct(0);
    setCapped(false);
    setMaxRedemptions(100);
    setDuration('permanent');
    setError(null);
  }

  function close(): void {
    reset();
    onClose();
  }

  async function submit(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const option = DURATION_OPTIONS.find((o) => o.key === duration);
      const expiresAt = option ? (expiresAtFor(option) ?? undefined) : undefined;
      await createPromoCode(
        {
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
          ...(owner ? { ownerCoachId: owner.id } : {}),
          discountPct,
          commissionPct,
          ...(capped ? { maxRedemptions } : {}),
          ...(expiresAt ? { expiresAt } : {}),
        },
        token,
      );
      close();
      onCreated();
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  return (
    <Sheet visible={visible} onClose={close} title="New promo code">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
        <SectionLabel>Code (optional)</SectionLabel>
        <AppTextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16))}
          placeholder="Leave blank to auto-generate"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
        />

        <SectionLabel>Owning coach (optional)</SectionLabel>
        {owner ? (
          <View style={styles.ownerChosen}>
            <AppText variant="bodyBold" numberOfLines={1} style={styles.ownerChosenText}>
              {coachDisplay(owner)}
            </AppText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Clear owning coach"
              onPress={() => setOwner(null)}
              style={styles.ownerClear}
            >
              <Ionicons name="close" size={16} color={colors.textDim} />
            </PressableScale>
          </View>
        ) : (
          <>
            <AppTextInput
              value={ownerQuery}
              onChangeText={setOwnerQuery}
              placeholder="Search coaches — leave blank for a house code"
              autoCapitalize="none"
            />
            {ownerResults.length > 0 ? (
              <View style={styles.ownerResults}>
                {ownerResults.map((c) => (
                  <PressableScale
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${coachDisplay(c)}`}
                    onPress={() => {
                      setOwner(c);
                      setOwnerQuery('');
                    }}
                    style={styles.ownerResultRow}
                  >
                    <AppText variant="body" numberOfLines={1}>
                      {coachDisplay(c)}
                    </AppText>
                  </PressableScale>
                ))}
              </View>
            ) : null}
          </>
        )}

        <SectionLabel>Discount / commission</SectionLabel>
        <View style={styles.stepperRow}>
          <Stepper label="Discount %" value={discountPct} onChange={setDiscountPct} step={5} min={5} max={90} />
          <Stepper label="Commission %" value={commissionPct} onChange={setCommissionPct} step={5} min={0} max={50} />
        </View>

        <SectionLabel>Redemption cap</SectionLabel>
        <PressableScale
          accessibilityRole="switch"
          accessibilityState={{ checked: capped }}
          accessibilityLabel="Limit redemptions"
          onPress={() => setCapped((v) => !v)}
          style={styles.toggleRow}
        >
          <AppText variant="body">{capped ? 'Limited' : 'Unlimited'}</AppText>
          <View style={[styles.switch, capped && styles.switchOn]}>
            <View style={[styles.knob, capped && styles.knobOn]} />
          </View>
        </PressableScale>
        {capped ? (
          <Stepper
            label="Max redemptions"
            value={maxRedemptions}
            onChange={setMaxRedemptions}
            step={10}
            min={1}
            max={100000}
          />
        ) : null}

        <SectionLabel>Expiry</SectionLabel>
        <View style={styles.chips}>
          {NON_CUSTOM_DURATIONS.map((o) => (
            <Chip key={o.key} label={o.label} selected={duration === o.key} onPress={() => setDuration(o.key)} />
          ))}
        </View>

        {error ? (
          <AppText variant="caption" color={colors.error} style={styles.formError}>
            {error}
          </AppText>
        ) : null}

        <Button
          label={saving ? 'Creating…' : 'Create code'}
          onPress={() => void submit()}
          loading={saving}
          disabled={saving}
          style={styles.createBtn}
        />
      </ScrollView>
    </Sheet>
  );
}

// ════════════════════════════════════════════════════════════════
// Screen
// ════════════════════════════════════════════════════════════════

export default function AdminPromosScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = canManagePromos(staffPermissions);

  const [codes, setCodes] = useState<PromoCodeRow[]>([]);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // G10: a failed deactivate/activate must be visible, not silently reverted
  // (the operator otherwise has zero signal that the toggle didn't take).
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [codeRows, coachRows] = await Promise.all([
        getAdminPromoCodes(token),
        getCoaches(token).catch(() => []),
      ]);
      setCodes(codeRows);
      setCoaches(coachRows);
    } catch (e) {
      setError(errorLine(toStaffError(e).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function toggleActive(row: PromoCodeRow): Promise<void> {
    if (!token || busyId) return;
    setBusyId(row.id);
    setToggleError(null);
    const next = !row.active;
    setCodes((prev) => prev.map((c) => (c.id === row.id ? { ...c, active: next } : c)));
    try {
      await updatePromoCode(row.id, { active: next }, token);
    } catch (e) {
      // Revert the optimistic flip AND surface why — a silent revert leaves
      // the operator thinking a live code is off when it's still on (G10).
      setCodes((prev) => prev.map((c) => (c.id === row.id ? { ...c, active: row.active } : c)));
      setToggleError(errorLine(toStaffError(e).code));
    } finally {
      setBusyId(null);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can manage promo codes.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      <Button
        label="New code"
        onPress={() => setCreating(true)}
        style={styles.newBtn}
      />

      {toggleError ? (
        <AppText variant="caption" color={colors.error} style={styles.toggleErrorText}>
          {toggleError}
        </AppText>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : codes.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No promo codes yet.
        </AppText>
      ) : (
        <View style={styles.list}>
          {codes.map((c, i) => (
            <Animated.View key={c.id} entering={enterUp(Math.min(i, 6))} style={styles.row}>
              <View style={styles.rowText}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {c.code}
                </AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {c.ownerCoach ? c.ownerCoach.displayName : 'House code'} · {c.discountPct}% off ·{' '}
                  {c.commissionPct}% commission
                </AppText>
                <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                  {c.redemptionCount}
                  {c.maxRedemptions ? `/${c.maxRedemptions}` : ''} redeemed ·{' '}
                  {expiryLabel(c.expiresAt)}
                </AppText>
              </View>
              <PressableScale
                accessibilityRole="switch"
                accessibilityState={{ checked: c.active }}
                accessibilityLabel={`${c.active ? 'Deactivate' : 'Activate'} code ${c.code}`}
                onPress={() => void toggleActive(c)}
                disabled={busyId === c.id}
                style={[styles.switch, c.active && styles.switchOn, busyId === c.id && styles.switchBusy]}
              >
                <View style={[styles.knob, c.active && styles.knobOn]} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      {token ? (
        <CreateSheet
          visible={creating}
          coaches={coaches}
          token={token}
          onClose={() => setCreating(false)}
          onCreated={() => void load()}
        />
      ) : null}
    </Screen>
  );
}

/** Shared back row + revamp header. */
function BackRow({ onBack }: { onBack: () => void }) {
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
      <ScreenHeader eyebrow="Admin console" title="Promo codes" style={styles.header} />
    </>
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
  newBtn: { marginBottom: spacing.lg },
  toggleErrorText: { marginBottom: spacing.md },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyLine: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  list: { gap: spacing.sm },
  // Charcoal list row (brief §11c): fill contrast, no hairline borders.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  rowText: { flex: 1, gap: 2 },
  // Switch track (mirrors coach/profile.tsx's toggle): filled, no stroke.
  switch: {
    width: 52,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfacePressed,
    padding: 4,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.accent },
  switchBusy: { opacity: 0.5 },
  knob: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignSelf: 'flex-start',
  },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.onBlock },
  // ── Create sheet ──
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  ownerChosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  ownerChosenText: { flex: 1 },
  ownerClear: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerResults: { marginTop: spacing.xs, gap: 2 },
  ownerResultRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: touch.min,
    justifyContent: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  formError: { marginTop: spacing.sm },
  createBtn: { marginTop: spacing.xl },
});
