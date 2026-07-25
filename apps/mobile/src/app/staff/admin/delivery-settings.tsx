import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../../../components/ui';
import {
  getDeliverySettings,
  toStaffError,
  updateDeliverySettings,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Delivery settings — the fees and order cutoffs every meal quote,
 * one-time order and weekly plan invoice prices itself from. One row on the
 * server, edited only from the web console until now: on a phone, changing a
 * delivery fee was impossible.
 *
 * Only the fields actually touched are sent, so two people editing different
 * amounts don't overwrite each other, and the server records what changed
 * along with who changed it.
 *
 * Money is typed in whole rupees and stored in paisa. Cutoffs are Kathmandu
 * wall-clock hours and apply to NEW orders only — an order already placed
 * keeps the fees and cutoff it was created with.
 */

type MoneyField =
  | 'deliveryFeeMinor'
  | 'freeDeliveryThresholdMinor'
  | 'smallOrderFeeMinor'
  | 'smallOrderThresholdMinor';
type HourField = 'lunchCutoffPrevDayHour' | 'dinnerCutoffSameDayHour';
type Field = MoneyField | HourField;

/** Server ceilings (api/admin/meal-config), mirrored for a friendly message. */
const MAX_FEE_RUPEES = 10_000;
const MAX_THRESHOLD_RUPEES = 100_000;

const MONEY_FIELDS: readonly { key: MoneyField; label: string; hint: string; maxRupees: number }[] = [
  {
    key: 'deliveryFeeMinor',
    label: 'Delivery fee',
    hint: 'Charged on every order below the free-delivery amount.',
    maxRupees: MAX_FEE_RUPEES,
  },
  {
    key: 'freeDeliveryThresholdMinor',
    label: 'Free delivery from',
    hint: 'Order total at which delivery stops costing anything. Set 0 to make every delivery free.',
    maxRupees: MAX_THRESHOLD_RUPEES,
  },
  {
    key: 'smallOrderFeeMinor',
    label: 'Small-order fee',
    hint: 'Added when the order is under the amount below.',
    maxRupees: MAX_FEE_RUPEES,
  },
  {
    key: 'smallOrderThresholdMinor',
    label: 'Small-order applies under',
    hint: 'An order below this pays the small-order fee.',
    maxRupees: MAX_THRESHOLD_RUPEES,
  },
];

const HOUR_FIELDS: readonly { key: HourField; label: string; hint: string }[] = [
  {
    key: 'lunchCutoffPrevDayHour',
    label: 'Lunch orders close at',
    hint: 'Kathmandu time on the day BEFORE delivery.',
  },
  {
    key: 'dinnerCutoffSameDayHour',
    label: 'Dinner orders close at',
    hint: 'Kathmandu time on the delivery day itself.',
  },
];

const ALL_FIELDS: readonly Field[] = [
  ...MONEY_FIELDS.map((f) => f.key),
  ...HOUR_FIELDS.map((f) => f.key),
];

function isMoneyField(field: Field): field is MoneyField {
  return (MONEY_FIELDS as readonly { key: Field }[]).some((f) => f.key === field);
}

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return "You don't have access to change delivery settings.";
    case 'invalid':
      return 'Some of those numbers are out of range. Check them and try again.';
    default:
      return "Couldn't reach the server. Check your connection and try again.";
  }
}

/** paisa → an editable whole-rupee string (5000 → "50"). */
function toRupees(minor: number): string {
  return String(Math.round(minor / 100));
}

/** Typed text → the number to store, or null when it isn't usable. */
function toStored(field: Field, raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  if (isMoneyField(field)) {
    const spec = MONEY_FIELDS.find((f) => f.key === field);
    if (spec && n > spec.maxRupees) return null;
    return Math.round(n * 100);
  }
  if (!Number.isInteger(n) || n > 23) return null;
  return n;
}

/** 21 → "9 pm", so an hour reads like a time rather than a number. */
function hourLabel(raw: string): string {
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > 23) return '';
  const suffix = n < 12 ? 'am' : 'pm';
  const h = n % 12 === 0 ? 12 : n % 12;
  return `${h} ${suffix}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

export default function AdminDeliverySettingsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'partners.manage');

  /** What the server last confirmed, as editable text. Also the save baseline. */
  const [seed, setSeed] = useState<Record<Field, string> | null>(null);
  const [edits, setEdits] = useState<Record<Field, string> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getDeliverySettings(token);
      const next: Record<Field, string> = {
        deliveryFeeMinor: toRupees(res.config.deliveryFeeMinor),
        freeDeliveryThresholdMinor: toRupees(res.config.freeDeliveryThresholdMinor),
        smallOrderFeeMinor: toRupees(res.config.smallOrderFeeMinor),
        smallOrderThresholdMinor: toRupees(res.config.smallOrderThresholdMinor),
        lunchCutoffPrevDayHour: String(res.config.lunchCutoffPrevDayHour),
        dinnerCutoffSameDayHour: String(res.config.dinnerCutoffSameDayHour),
      };
      setSeed(next);
      setEdits(next);
      setUpdatedAt(res.updatedAt);
      setPersisted(res.persisted);
    } catch (err) {
      setLoadError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const dirty = useMemo(() => {
    if (!seed || !edits) return false;
    return ALL_FIELDS.some((f) => edits[f] !== seed[f]);
  }, [seed, edits]);

  function setField(field: Field, value: string): void {
    setJustSaved(false);
    setSaveError(null);
    setEdits((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  const save = useCallback(async () => {
    if (!token || !seed || !edits || saving) return;
    const patch: Partial<Record<Field, number>> = {};
    for (const field of ALL_FIELDS) {
      if (edits[field] === seed[field]) continue;
      const stored = toStored(field, edits[field]);
      if (stored === null) {
        const spec = MONEY_FIELDS.find((f) => f.key === field);
        setSaveError(
          spec
            ? `"${spec.label}" must be a whole amount in rupees, from 0 to ${spec.maxRupees.toLocaleString()}.`
            : 'An hour must be a whole number from 0 to 23.',
        );
        return;
      }
      patch[field] = stored;
    }
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const res = await updateDeliverySettings(patch, token);
      successHaptic();
      const next: Record<Field, string> = {
        deliveryFeeMinor: toRupees(res.config.deliveryFeeMinor),
        freeDeliveryThresholdMinor: toRupees(res.config.freeDeliveryThresholdMinor),
        smallOrderFeeMinor: toRupees(res.config.smallOrderFeeMinor),
        smallOrderThresholdMinor: toRupees(res.config.smallOrderThresholdMinor),
        lunchCutoffPrevDayHour: String(res.config.lunchCutoffPrevDayHour),
        dinnerCutoffSameDayHour: String(res.config.dinnerCutoffSameDayHour),
      };
      // Re-seed from what the server kept, so a second save can't push stale
      // numbers back over someone else's change.
      setSeed(next);
      setEdits(next);
      setUpdatedAt(res.updatedAt);
      setPersisted(res.persisted);
      setJustSaved(true);
    } catch (err) {
      setSaveError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }, [token, seed, edits, saving]);

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
            You don&apos;t have access to change delivery settings.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <BackRow onBack={goBack} />

      {loading && !edits ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError && !edits ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry loading delivery settings"
          onPress={() => void load()}
          style={styles.retry}
        >
          <Ionicons name="refresh" size={15} color={colors.textDim} />
          <AppText variant="caption">{loadError} Tap to retry.</AppText>
        </PressableScale>
      ) : edits ? (
        <>
          <AppText variant="body" color={colors.textDim} style={styles.blurb}>
            These apply to every partner kitchen. New orders and weekly plan invoices use them
            right away; orders already placed keep what they were created with.
          </AppText>
          <AppText variant="caption" color={colors.textFaint} style={styles.stamp}>
            {persisted && updatedAt
              ? `Last saved ${formatWhen(updatedAt)}`
              : 'Never changed, so these are the built-in amounts'}
          </AppText>

          <SectionLabel>Fees</SectionLabel>
          {MONEY_FIELDS.map((f) => (
            <View key={f.key} style={styles.field}>
              <AppText variant="bodyBold">{f.label}</AppText>
              <AppText variant="caption" color={colors.textFaint}>
                {f.hint}
              </AppText>
              <View style={styles.inputRow}>
                <AppText variant="body" color={colors.textDim} style={styles.prefix}>
                  Rs
                </AppText>
                <AppTextInput
                  value={edits[f.key]}
                  onChangeText={(v) => setField(f.key, v)}
                  keyboardType="number-pad"
                  editable={!saving}
                  style={styles.input}
                  accessibilityLabel={`${f.label} in rupees`}
                />
              </View>
            </View>
          ))}

          <SectionLabel>Order cutoffs</SectionLabel>
          {HOUR_FIELDS.map((f) => {
            const reads = hourLabel(edits[f.key]);
            return (
              <View key={f.key} style={styles.field}>
                <AppText variant="bodyBold">{f.label}</AppText>
                <AppText variant="caption" color={colors.textFaint}>
                  {f.hint}
                </AppText>
                <View style={styles.inputRow}>
                  <AppTextInput
                    value={edits[f.key]}
                    onChangeText={(v) => setField(f.key, v)}
                    keyboardType="number-pad"
                    editable={!saving}
                    style={styles.input}
                    accessibilityLabel={`${f.label}, hour of the day from 0 to 23`}
                  />
                  <AppText variant="body" color={reads ? colors.text : colors.error} style={styles.suffix}>
                    {reads || 'Use 0 to 23'}
                  </AppText>
                </View>
              </View>
            );
          })}

          {saveError ? (
            <AppText variant="caption" color={colors.error} style={styles.message}>
              {saveError}
            </AppText>
          ) : null}
          {justSaved && !dirty ? (
            <AppText variant="caption" color={colors.textDim} style={styles.message}>
              Saved. Every new order prices from these now.
            </AppText>
          ) : null}

          <Button
            label={saving ? 'Saving…' : 'Save delivery settings'}
            onPress={() => void save()}
            loading={saving}
            disabled={saving || !dirty}
            style={styles.saveBtn}
          />
        </>
      ) : null}
    </Screen>
  );
}

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
      <ScreenHeader eyebrow="Admin console" title="Delivery" style={styles.header} />
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
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  blurb: { marginBottom: spacing.xs },
  stamp: { marginBottom: spacing.sm },
  field: { gap: spacing.xs, marginBottom: spacing.lg },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  prefix: { minWidth: 28 },
  input: { flex: 1 },
  suffix: { minWidth: 96 },
  message: { marginTop: spacing.sm },
  saveBtn: { marginTop: spacing.lg, marginBottom: spacing.xl },
});
