import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatMoney } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Chip,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  addWalletEntry,
  exportCsvToFile,
  getAdminWalletDetail,
  getAdminWallets,
  toStaffError,
  type AdminWalletDetail,
  type AdminWalletRow,
  type StaffErrorCode,
  type WalletEntry,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * P1-10 CSV export contract: exportCsvToFile(kind, token) => Promise<string>
 * (M2 owns features/staff/api.ts — see the fuller note in members.tsx)
 * downloads the CSV straight to a local file (native-side streaming; never
 * buffered into one JS string) and returns its `file://` URI. No
 * expo-sharing dependency exists in this app, so the file goes through RN's
 * built-in Share sheet (`url` so iOS attaches it); the on-device path stays
 * visible as a selectable-text fallback when the share sheet is
 * unavailable/dismissed.
 */
async function shareFile(uri: string): Promise<void> {
  try {
    await Share.share({ url: uri });
  } catch {
    // Share sheet dismissed/unavailable — the file stays on-device; its
    // path stays visible as text.
  }
}

/**
 * Admin · Wallets — every coach's commission balance + per-coach ledger (gap
 * build P0-5, wiring the previously-dead getAdminWallets/addWalletEntry
 * client fns, contract §4.8's getAdminWalletDetail). Permission:
 * `wallet.manage`.
 *
 * Roster: one row per coach with a rolled-up per-currency balance summary.
 * Tapping a row opens a drawer with the FULL per-coach ledger (fixes E9 — the
 * old drawer read off a global newest-500 feed and could show 'No entries
 * yet' for a coach with real history) plus a form to record a manual
 * adjustment or payout (E7: currency locked to the two the catalog actually
 * uses, never free text; a payout is always recorded as a negative amount).
 */

const CURRENCIES: readonly string[] = ['NPR', 'USD'];

type EntryKind = 'adjustment' | 'payout';

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_found') return 'That coach is no longer available.';
  // Defensive fallback — EntryForm.submit() special-cases this to arm the
  // override flow instead, but keep a non-generic message here too in case
  // it ever surfaces elsewhere (defect #2).
  if (code === 'insufficient_balance')
    return "This payout would take the coach's balance negative.";
  return "Couldn't load wallets.";
}

/** Roll a coach's per-currency balances into one compact line. */
function balanceSummary(balances: AdminWalletRow['balances']): string {
  if (balances.length === 0) return 'No balance yet';
  return balances.map((b) => formatMoney(b.amountMinor, b.currency)).join(' · ');
}

function entryTone(entry: WalletEntry): { label: string; color: string } {
  if (entry.type === 'commission') return { label: 'Commission', color: colors.success };
  if (entry.type === 'payout') return { label: 'Payout', color: colors.warning };
  return { label: 'Adjustment', color: colors.blue };
}

/** "3:42 PM, Jan 5" — local wall-clock, deterministic (no Intl dependency). */
function entryTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
// Entry form
// ════════════════════════════════════════════════════════════════

function EntryForm({
  coachId,
  token,
  onSaved,
}: {
  coachId: string;
  token: string;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<EntryKind>('adjustment');
  // Adjustments can be a correction in either direction; payouts are always
  // recorded as money leaving the coach's balance (negative), so the sign
  // toggle only applies to 'adjustment' (defect E8 on the web console).
  const [credit, setCredit] = useState(true);
  const [currency, setCurrency] = useState<string>('NPR');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Defect #2: the server's balance floor for payouts (409
  // 'insufficient_balance') has an explicit override escape hatch, but mobile
  // never sent it and never surfaced why the save failed. Armed only by that
  // exact error for the exact payout that triggered it — any field edit
  // invalidates it, so a stale confirmation can never silently apply to a
  // different amount.
  const [overrideArmedFor, setOverrideArmedFor] = useState<string | null>(null);

  function reset(): void {
    setAmount('');
    setNote('');
    setError(null);
    setOverrideArmedFor(null);
  }

  async function submit(): Promise<void> {
    const major = Number(amount.trim());
    if (!amount.trim() || !Number.isFinite(major) || major <= 0) {
      setError('Enter a positive amount.');
      setOverrideArmedFor(null);
      return;
    }
    const magnitude = Math.round(major * 100);
    const signed = kind === 'payout' ? -magnitude : credit ? magnitude : -magnitude;
    const requestKey = `${kind}|${currency}|${signed}`;
    const override = kind === 'payout' && overrideArmedFor === requestKey;
    setSaving(true);
    setError(null);
    try {
      await addWalletEntry(
        coachId,
        {
          type: kind,
          amountMinor: signed,
          currency,
          note: note.trim() || undefined,
          ...(override ? { override: true } : {}),
        },
        token,
      );
      reset();
      onSaved();
    } catch (e) {
      const code = toStaffError(e).code;
      if (kind === 'payout' && code === 'insufficient_balance' && !override) {
        setOverrideArmedFor(requestKey);
        setError(
          'This payout would take the balance negative. Tap Record payout again to record it anyway.',
        );
      } else {
        setOverrideArmedFor(null);
        setError(errorLine(code));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.formBlock}>
      <SectionLabel>Record an entry</SectionLabel>

      <View style={styles.chipsRow}>
        <Chip label="Adjustment" selected={kind === 'adjustment'} onPress={() => setKind('adjustment')} />
        <Chip label="Payout" selected={kind === 'payout'} onPress={() => setKind('payout')} />
      </View>

      {kind === 'adjustment' ? (
        <View style={styles.chipsRow}>
          <Chip label="Credit (+)" selected={credit} onPress={() => setCredit(true)} />
          <Chip label="Debit (−)" selected={!credit} onPress={() => setCredit(false)} />
        </View>
      ) : (
        <AppText variant="caption" color={colors.textFaint}>
          Recorded as money paid OUT — always a debit.
        </AppText>
      )}

      <View style={styles.chipsRow}>
        {CURRENCIES.map((c) => (
          <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
        ))}
      </View>

      <AppTextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount"
        keyboardType="decimal-pad"
        editable={!saving}
        accessibilityLabel="Entry amount"
      />
      <AppTextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional, audited)"
        multiline
        editable={!saving}
        style={styles.noteInput}
      />

      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}

      <Button
        label={saving ? 'Saving…' : kind === 'payout' ? 'Record payout' : 'Record adjustment'}
        onPress={() => void submit()}
        loading={saving}
        disabled={saving}
        style={styles.formSaveBtn}
      />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Coach detail drawer
// ════════════════════════════════════════════════════════════════

function WalletDrawer({
  coachId,
  token,
  onClose,
  onChanged,
}: {
  coachId: string;
  token: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminWalletDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await getAdminWalletDetail(coachId, token));
    } catch (e) {
      setError(errorLine(toStaffError(e).code));
    } finally {
      setLoading(false);
    }
  }, [coachId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Sheet visible onClose={onClose} title={detail ? detail.coach.displayName : 'Wallet'}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <View style={styles.retryWrap}>
            <RetryLine message={error} onRetry={() => void load()} />
          </View>
        ) : detail ? (
          <>
            <Tag label={detail.coach.coachTier.toUpperCase()} variant="dim" />

            <SectionLabel>Balances</SectionLabel>
            {detail.balances.length === 0 ? (
              <AppText variant="caption" color={colors.textFaint}>
                No balance recorded yet.
              </AppText>
            ) : (
              <View style={styles.balanceRow}>
                {detail.balances.map((b) => (
                  <Tag key={b.currency} label={formatMoney(b.amountMinor, b.currency)} variant="outline" />
                ))}
              </View>
            )}

            <SectionLabel>Ledger</SectionLabel>
            {detail.entries.length === 0 ? (
              <AppText variant="caption" color={colors.textFaint}>
                No entries yet.
              </AppText>
            ) : (
              <View style={styles.entryList}>
                {detail.entries.map((e) => {
                  const tone = entryTone(e);
                  return (
                    <View key={e.id} style={styles.entryRow}>
                      <IconChip
                        icon={e.amountMinor >= 0 ? 'arrow-down' : 'arrow-up'}
                        size={32}
                        iconColor={tone.color}
                      />
                      <View style={styles.entryText}>
                        <AppText variant="body" numberOfLines={1}>
                          {tone.label}
                          {e.note ? ` · ${e.note}` : ''}
                        </AppText>
                        <AppText variant="caption" color={colors.textFaint}>
                          {entryTimestamp(e.createdAt)}
                        </AppText>
                      </View>
                      <AppText
                        variant="bodyBold"
                        tabular
                        color={e.amountMinor >= 0 ? colors.success : colors.error}
                      >
                        {e.amountMinor >= 0 ? '+' : ''}
                        {formatMoney(e.amountMinor, e.currency)}
                      </AppText>
                    </View>
                  );
                })}
              </View>
            )}

            <EntryForm
              coachId={coachId}
              token={token}
              onSaved={() => {
                void load();
                onChanged();
              }}
            />
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

// ════════════════════════════════════════════════════════════════
// Screen
// ════════════════════════════════════════════════════════════════

export default function AdminWalletsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'wallet.manage');

  const [wallets, setWallets] = useState<AdminWalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCoachId, setOpenCoachId] = useState<string | null>(null);

  // P1-10: CSV export of the wallet ledger.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvLink, setCsvLink] = useState<string | null>(null);

  async function exportWalletsCsv(): Promise<void> {
    if (!token || csvBusy) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const uri = await exportCsvToFile('wallet-ledger', token);
      setCsvLink(uri);
      await shareFile(uri);
    } catch {
      setCsvError("Couldn't export the wallet ledger.");
    } finally {
      setCsvBusy(false);
    }
  }

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setWallets(await getAdminWallets(token));
    } catch (e) {
      setError(errorLine(toStaffError(e).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

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
            Only a super admin or main admin can manage coach wallets.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow
        onBack={goBack}
        action={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Export wallet ledger as CSV"
            accessibilityState={{ disabled: csvBusy }}
            disabled={csvBusy}
            onPress={() => void exportWalletsCsv()}
            style={styles.headerActionBtn}
          >
            {csvBusy ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="download-outline" size={20} color={colors.text} />
            )}
          </PressableScale>
        }
      />

      {csvError ? (
        <AppText variant="caption" color={colors.error} style={styles.csvErrorText}>
          {csvError}
        </AppText>
      ) : null}

      {csvLink ? (
        <View style={styles.csvLinkBlock}>
          <AppText variant="caption" color={colors.textDim}>
            Export saved on this device (long-press to copy the file path if the share sheet
            didn&apos;t open):
          </AppText>
          <Text selectable style={styles.selectableLink}>
            {csvLink}
          </Text>
          <Button label="Dismiss" variant="secondary" onPress={() => setCsvLink(null)} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : wallets.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          No coaches yet.
        </AppText>
      ) : (
        <View style={styles.list}>
          {wallets.map((w, i) => (
            <Animated.View key={w.coach.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open wallet for ${w.coach.displayName}`}
                onPress={() => setOpenCoachId(w.coach.id)}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {w.coach.displayName}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {w.coach.coachTier} · {balanceSummary(w.balances)}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      {openCoachId && token ? (
        <WalletDrawer
          coachId={openCoachId}
          token={token}
          onClose={() => setOpenCoachId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </Screen>
  );
}

/** Shared back row + revamp header. */
function BackRow({ onBack, action }: { onBack: () => void; action?: ReactNode }) {
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
      <ScreenHeader eyebrow="Admin console" title="Wallets" style={styles.header} action={action} />
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
  headerActionBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  csvErrorText: { marginBottom: spacing.sm },
  csvLinkBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  selectableLink: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
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
  emptyLine: { marginTop: spacing.lg, paddingHorizontal: spacing.xs },
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
  rowText: { flex: 1, gap: 2 },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  balanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  entryList: { gap: spacing.sm },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  entryText: { flex: 1, gap: 2 },
  formBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  noteInput: { minHeight: 56, paddingTop: 14, textAlignVertical: 'top' },
  formSaveBtn: { marginTop: spacing.sm },
});
