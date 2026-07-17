import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
} from '../../../components/ui';
import {
  getAdminPricing,
  putAdminPricing,
  toStaffError,
  type PriceRegion,
  type PriceRow,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Pricing — the regional (NP / INTL) tier-price grid (gap build P0-5,
 * mirroring the FIXED web semantics rather than the pre-fix web bug: E2 —
 * a blank field must never silently save as 0 (a paid tier turning free) —
 * and E3 — dirty cells only, re-seeded from the server on every load so a
 * second admin's concurrent edit isn't silently last-write-lost).
 *
 * `starter` is always free and shown read-only; silver/gold/elite are
 * editable per region in MAJOR units (rupees / dollars) — converted to
 * integer minor units on save. Currency is derived server-side from region;
 * this screen never sends one. Permission: `pricing.manage`.
 */

const REGIONS: readonly { key: PriceRegion; label: string; currency: string }[] = [
  { key: 'NP', label: 'Nepal', currency: 'NPR' },
  { key: 'INTL', label: 'International', currency: 'USD' },
];

const EDITABLE_TIERS: readonly Tier[] = ['silver', 'gold', 'elite'];

const TIER_LABEL: Record<Tier, string> = {
  starter: 'Starter',
  silver: 'Silver',
  gold: 'Gold',
  elite: 'Elite',
};

function cellKey(region: PriceRegion, tier: Tier): string {
  return `${region}:${tier}`;
}

/** amountMinor → an editable major-unit string (49900 → "499", 999 → "9.99"). */
function toMajorInput(amountMinor: number): string {
  return (amountMinor / 100).toString();
}

/**
 * Editable major-unit text → integer minor units, or `null` when the value
 * is unusable — BLANK/whitespace-only, non-numeric, or negative (defect E2:
 * `Number('')` is 0, so an explicit blank check is required — a numeric
 * coercion alone silently turns a paid tier free).
 */
function toMinor(major: string): number | null {
  const trimmed = major.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'invalid') return 'One or more prices were rejected. Check the amounts and try again.';
  return "Couldn't load pricing.";
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

export default function AdminPricingScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'pricing.manage');

  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Keyed by "region:tier" → the editable major-unit string. Re-seeded from
  // the server on every successful load (E3) so a stale local edit never
  // silently clobbers a value another admin changed since this screen opened.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const byKey = useMemo(() => {
    const m = new Map<string, PriceRow>();
    for (const p of prices) m.set(cellKey(p.region, p.tier), p);
    return m;
  }, [prices]);

  function seedEdits(rows: PriceRow[]): void {
    const byK = new Map<string, PriceRow>();
    for (const p of rows) byK.set(cellKey(p.region, p.tier), p);
    const next: Record<string, string> = {};
    for (const region of REGIONS) {
      for (const tier of EDITABLE_TIERS) {
        const cell = byK.get(cellKey(region.key, tier));
        next[cellKey(region.key, tier)] = toMajorInput(cell?.amountMinor ?? 0);
      }
    }
    setEdits(next);
  }

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getAdminPricing(token);
      setPrices(rows);
      seedEdits(rows);
    } catch (e) {
      setError(errorLine(toStaffError(e).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const dirty = useMemo(() => {
    for (const region of REGIONS) {
      for (const tier of EDITABLE_TIERS) {
        const k = cellKey(region.key, tier);
        const cell = byKey.get(k);
        const original = toMajorInput(cell?.amountMinor ?? 0);
        if ((edits[k] ?? original) !== original) return true;
      }
    }
    return false;
  }, [edits, byKey]);

  function setCell(region: PriceRegion, tier: Tier, value: string): void {
    setSaved(false);
    setEdits((prev) => ({ ...prev, [cellKey(region, tier)]: value }));
  }

  async function save(): Promise<void> {
    if (!token || saving) return;
    // E3: send only the cells that actually changed from the server's value.
    const patch: { region: PriceRegion; tier: Tier; amountMinor: number }[] = [];
    for (const region of REGIONS) {
      for (const tier of EDITABLE_TIERS) {
        const k = cellKey(region.key, tier);
        const cell = byKey.get(k);
        const original = toMajorInput(cell?.amountMinor ?? 0);
        const value = edits[k] ?? original;
        if (value === original) continue;
        const minor = toMinor(value);
        if (minor === null) {
          setSaveError(`Enter a valid amount for ${region.label} · ${TIER_LABEL[tier]}.`);
          return;
        }
        patch.push({ region: region.key, tier, amountMinor: minor });
      }
    }
    if (patch.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const rows = await putAdminPricing(patch, token);
      setPrices(rows);
      seedEdits(rows);
      setSaved(true);
    } catch (e) {
      setSaveError(errorLine(toStaffError(e).code));
    } finally {
      setSaving(false);
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
            Only a super admin or main admin can manage regional pricing.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <BackRow onBack={goBack} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : (
        <View style={styles.regions}>
          {REGIONS.map((region, ri) => (
            <Animated.View key={region.key} entering={enterUp(ri)}>
              <Card style={styles.regionCard}>
                <View style={styles.regionHeader}>
                  <AppText variant="bodyBold">{region.label}</AppText>
                  <AppText variant="caption" color={colors.textFaint}>
                    {region.currency} / month
                  </AppText>
                </View>

                <View style={styles.starterRow}>
                  <AppText variant="caption" color={colors.textFaint}>
                    Starter
                  </AppText>
                  <AppText variant="body" color={colors.textDim}>
                    Free
                  </AppText>
                </View>

                {EDITABLE_TIERS.map((tier) => {
                  const k = cellKey(region.key, tier);
                  const value = edits[k] ?? '';
                  const preview = toMinor(value);
                  return (
                    <View key={tier} style={styles.tierRow}>
                      <AppText variant="body" style={styles.tierLabel}>
                        {TIER_LABEL[tier]}
                      </AppText>
                      <View style={styles.amountField}>
                        <AppText variant="caption" color={colors.textFaint} style={styles.currencyPrefix}>
                          {region.currency === 'NPR' ? 'Rs' : '$'}
                        </AppText>
                        <AppTextInput
                          value={value}
                          onChangeText={(t) => setCell(region.key, tier, t)}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          editable={!saving}
                          style={styles.amountInput}
                          accessibilityLabel={`${region.label} ${TIER_LABEL[tier]} price`}
                        />
                      </View>
                      <AppText variant="caption" color={colors.textFaint} tabular>
                        {preview !== null ? formatMoney(preview, region.currency) : '—'}
                      </AppText>
                    </View>
                  );
                })}
              </Card>
            </Animated.View>
          ))}
        </View>
      )}

      {saveError ? (
        <AppText variant="caption" color={colors.error} style={styles.saveErrorText}>
          {saveError}
        </AppText>
      ) : saved ? (
        <AppText variant="caption" color={colors.success} style={styles.saveErrorText}>
          Prices updated.
        </AppText>
      ) : null}

      <Button
        label={saving ? 'Saving…' : 'Save changes'}
        onPress={() => void save()}
        loading={saving}
        disabled={saving || !dirty}
        style={styles.saveBtn}
      />
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
      <ScreenHeader eyebrow="Admin console" title="Pricing" style={styles.header} />
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
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retryWrap: { marginTop: spacing.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  regions: { gap: spacing.md },
  regionCard: { gap: spacing.sm },
  regionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  starterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tierLabel: { width: 56 },
  amountField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: touch.min,
  },
  currencyPrefix: { width: 20 },
  amountInput: {
    flex: 1,
    borderWidth: 0,
    minHeight: touch.min,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  saveErrorText: { marginTop: spacing.md },
  saveBtn: { marginTop: spacing.lg },
});
