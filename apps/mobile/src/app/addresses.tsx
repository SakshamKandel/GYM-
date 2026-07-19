import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  ConfirmDialog,
  EmptyState,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
} from '../components/ui';
import {
  createSavedAddress,
  deleteSavedAddress,
  getSavedAddresses,
  toAddressError,
  updateSavedAddress,
  type SavedAddress,
} from '../features/addresses/api';
import { useAuth } from '../state/auth';

/**
 * /addresses — the member's saved delivery-address book (Pack P), the
 * first mobile client of the pre-existing `savedAddresses` CRUD API
 * (`apps/web/src/app/api/meals/addresses/route.ts`). A flat list with
 * "Set default", edit and delete; a Sheet form handles both add and edit.
 */

interface FormState {
  id: string | null;
  label: string;
  line: string;
  area: string;
  phone: string;
  isDefault: boolean;
}

const EMPTY_FORM: FormState = { id: null, label: '', line: '', area: '', phone: '', isDefault: false };

function errorLine(code: ReturnType<typeof toAddressError>['code']): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'not_found') return 'That address is no longer available.';
  if (code === 'invalid') return 'Check the address fields and try again.';
  return "Couldn't reach the server.";
}

function AddressRow({
  address,
  onEdit,
  onDelete,
  onSetDefault,
  busy,
}: {
  address: SavedAddress;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name="location" size={20} color={address.isDefault ? colors.accent : colors.textDim} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.rowTitleGrow}>
            {address.label.trim() || 'Address'}
          </AppText>
          {address.isDefault ? (
            <View style={styles.defaultTag}>
              <AppText variant="label" color={colors.onBlock}>
                DEFAULT
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" numberOfLines={2} color={colors.textDim}>
          {[address.line, address.area].filter(Boolean).join(', ')}
        </AppText>
        <AppText variant="caption" color={colors.textFaint}>
          {address.phone}
        </AppText>
      </View>
      <View style={styles.rowActions}>
        {!address.isDefault ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Set as default address"
            onPress={onSetDefault}
            disabled={busy}
            style={styles.iconBtn}
          >
            <Ionicons name="star-outline" size={18} color={colors.textDim} />
          </PressableScale>
        ) : null}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Edit address"
          onPress={onEdit}
          style={styles.iconBtn}
        >
          <Ionicons name="create-outline" size={18} color={colors.textDim} />
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Delete address"
          onPress={onDelete}
          style={styles.iconBtn}
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </PressableScale>
      </View>
    </View>
  );
}

export default function AddressesScreen() {
  const token = useAuth((s) => s.token);

  const [rows, setRows] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<SavedAddress | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await getSavedAddresses(token));
    } catch (e) {
      setError(errorLine(toAddressError(e).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openAdd(): void {
    setForm(EMPTY_FORM);
    setSaveError(null);
    setFormVisible(true);
  }

  function openEdit(address: SavedAddress): void {
    setForm({
      id: address.id,
      label: address.label,
      line: address.line,
      area: address.area,
      phone: address.phone,
      isDefault: address.isDefault,
    });
    setSaveError(null);
    setFormVisible(true);
  }

  const canSave = form.line.trim().length > 0 && form.phone.trim().length > 0 && !saving;

  async function save(): Promise<void> {
    if (!token || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input = {
        label: form.label.trim() || undefined,
        line: form.line.trim(),
        area: form.area.trim() || undefined,
        phone: form.phone.trim(),
        isDefault: form.isDefault,
      };
      if (form.id) await updateSavedAddress(form.id, input, token);
      else await createSavedAddress(input, token);
      setFormVisible(false);
      await load();
    } catch (e) {
      setSaveError(errorLine(toAddressError(e).code));
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(address: SavedAddress): Promise<void> {
    if (!token || rowBusyId) return;
    setRowBusyId(address.id);
    try {
      await updateSavedAddress(address.id, { isDefault: true }, token);
      await load();
    } catch {
      // Best-effort — the row simply stays non-default; no dead-end, just
      // retry from the same row.
    } finally {
      setRowBusyId(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!token || !pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setRowBusyId(target.id);
    try {
      await deleteSavedAddress(target.id, token);
      await load();
    } catch {
      setError("Couldn't delete that address — try again.");
    } finally {
      setRowBusyId(null);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
      }
    >
      <Animated.View entering={enterDown()} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.backSpacer} />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add a new address"
          onPress={openAdd}
          style={styles.addBtn}
        >
          <Ionicons name="add" size={22} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScreenHeader eyebrow="Delivery" title="Saved addresses" style={styles.header} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={() => void load()}
          style={styles.retry}
        >
          <Ionicons name="refresh" size={15} color={colors.textDim} />
          <AppText variant="caption">{error} Tap to retry.</AppText>
        </PressableScale>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="location-outline"
          title="No saved addresses yet"
          body="Add a delivery address once and reuse it at checkout."
          actionLabel="Add address"
          onAction={openAdd}
        />
      ) : (
        <Animated.View entering={enterUp(0)} style={styles.list}>
          {rows.map((row) => (
            <AddressRow
              key={row.id}
              address={row}
              onEdit={() => openEdit(row)}
              onDelete={() => setPendingDelete(row)}
              onSetDefault={() => void setDefault(row)}
              busy={rowBusyId === row.id}
            />
          ))}
        </Animated.View>
      )}

      <Sheet
        visible={formVisible}
        onClose={() => setFormVisible(false)}
        title={form.id ? 'Edit address' : 'New address'}
      >
        <View style={styles.formBody}>
          <SectionLabel>Label (optional)</SectionLabel>
          <AppTextInput
            value={form.label}
            onChangeText={(v) => setForm((f) => ({ ...f, label: v }))}
            placeholder="Home, Work…"
            maxLength={60}
            accessibilityLabel="Address label"
          />
          <SectionLabel>Address</SectionLabel>
          <AppTextInput
            value={form.line}
            onChangeText={(v) => setForm((f) => ({ ...f, line: v }))}
            placeholder="Street, building, floor"
            maxLength={200}
            multiline
            style={styles.multiline}
            accessibilityLabel="Street address"
          />
          <SectionLabel>Area (optional)</SectionLabel>
          <AppTextInput
            value={form.area}
            onChangeText={(v) => setForm((f) => ({ ...f, area: v }))}
            placeholder="Neighborhood / landmark"
            maxLength={120}
            accessibilityLabel="Area or landmark"
          />
          <SectionLabel>Phone</SectionLabel>
          <AppTextInput
            value={form.phone}
            onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
            placeholder="Contact number for delivery"
            keyboardType="phone-pad"
            maxLength={40}
            accessibilityLabel="Delivery contact phone"
          />

          <PressableScale
            accessibilityRole="checkbox"
            accessibilityState={{ checked: form.isDefault }}
            accessibilityLabel="Set as default address"
            onPress={() => setForm((f) => ({ ...f, isDefault: !f.isDefault }))}
            style={styles.checkboxRow}
          >
            <Ionicons
              name={form.isDefault ? 'checkbox' : 'square-outline'}
              size={22}
              color={form.isDefault ? colors.accent : colors.textDim}
            />
            <AppText variant="body">Set as default</AppText>
          </PressableScale>

          {saveError ? (
            <AppText variant="caption" color={colors.error}>
              {saveError}
            </AppText>
          ) : null}

          <Button
            label={saving ? 'Saving…' : 'Save address'}
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this address?"
        message="You can always add it again later."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  backSpacer: { flex: 1 },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 72,
  },
  rowIcon: { width: 36, alignItems: 'center' },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitleGrow: { flexShrink: 1 },
  defaultTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  rowActions: { flexDirection: 'row', gap: spacing.xs },
  iconBtn: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBody: { gap: spacing.sm, paddingBottom: spacing.xl },
  multiline: { minHeight: 72, paddingTop: 14, textAlignVertical: 'top' },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.min,
    marginTop: spacing.xs,
  },
});
