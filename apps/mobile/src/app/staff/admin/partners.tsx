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
  ConfirmDialog,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
  Sheet,
  Tag,
} from '../../../components/ui';
import {
  createPartner,
  deactivatePartner,
  listPartnersAdmin,
  toStaffError,
  updatePartner,
  type PartnerCreateInput,
  type PartnerPatch,
  type PartnerRow,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Meal partners (`partners.manage` — super/main only, no sub-role
 * preset). Mobile parity C (N3): roster + create (mints the ONLY partner
 * login, credentials shown once right after) + edit contact/service-areas
 * text + deactivate.
 *
 * Deliberately mobile-scoped vs. the web console: the map-based service-area
 * radius picker (Leaflet) is web-only, so this screen edits `serviceAreas` as
 * a plain comma-separated text list — the same column the checkout matcher
 * reads, just without the visual radius. Deactivating a partner kills every
 * live session for that login (a second kill-switch alongside
 * `requirePartner`'s live `isActive` check) so it is reauth-gated + confirmed,
 * mirroring the staff-revoke pattern.
 */

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return "You don't have access to manage meal partners.";
    case 'not_found':
      return 'That partner no longer exists.';
    case 'conflict':
      return 'An account already exists with that email.';
    case 'invalid':
      return "Some details were rejected. Check the fields and try again.";
    default:
      return "Couldn't reach the server. Try again.";
  }
}

function parseServiceAreas(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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

function CurrencyChips({
  value,
  onChange,
  disabled,
}: {
  value: 'NPR' | 'USD';
  onChange: (v: 'NPR' | 'USD') => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.chips}>
      {(['NPR', 'USD'] as const).map((c) => (
        <Chip key={c} label={c} selected={value === c} onPress={() => !disabled && onChange(c)} />
      ))}
    </View>
  );
}

function CodToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel="Accepts cash on delivery"
      onPress={() => !disabled && onChange(!value)}
      style={styles.toggleRow}
    >
      <AppText variant="body">Accepts cash on delivery</AppText>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </PressableScale>
  );
}

// ════════════════════════════════════════════════════════════════
// Create sheet + one-time credentials confirmation
// ════════════════════════════════════════════════════════════════

interface CreatedCreds {
  name: string;
  email: string;
  password: string;
}

function CreateSheet({
  visible,
  token,
  onClose,
  onCreated,
}: {
  visible: boolean;
  token: string;
  onClose: () => void;
  onCreated: (creds: CreatedCreds) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [addressText, setAddressText] = useState('');
  const [serviceAreas, setServiceAreas] = useState('');
  const [acceptsCod, setAcceptsCod] = useState(true);
  const [currency, setCurrency] = useState<'NPR' | 'USD'>('NPR');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setName('');
    setEmail('');
    setPassword('');
    setContact('');
    setPhone('');
    setAddressText('');
    setServiceAreas('');
    setAcceptsCod(true);
    setCurrency('NPR');
    setError(null);
  }

  function close(): void {
    if (saving) return;
    reset();
    onClose();
  }

  async function submit(): Promise<void> {
    if (saving) return;
    if (!email.trim() || !password || !name.trim()) {
      setError('Email, password, and restaurant name are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    setError(null);
    const input: PartnerCreateInput = {
      email: email.trim(),
      password,
      name: name.trim(),
      contact: contact.trim(),
      phone: phone.trim(),
      addressText: addressText.trim(),
      serviceAreas: parseServiceAreas(serviceAreas),
      acceptsCod,
      currency,
    };
    try {
      await createPartner(input, token);
      const creds: CreatedCreds = { name: input.name, email: input.email, password };
      reset();
      onClose();
      onCreated(creds);
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={close} title="New meal partner">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
        <AppText variant="caption" color={colors.textDim}>
          Mints a new web-only login for this restaurant AND its partner row
          together — this is the only way a partner account is ever created.
        </AppText>

        <SectionLabel>Restaurant name</SectionLabel>
        <AppTextInput value={name} onChangeText={setName} placeholder="Restaurant name" editable={!saving} />

        <SectionLabel>Contact person</SectionLabel>
        <AppTextInput value={contact} onChangeText={setContact} placeholder="Optional" editable={!saving} />

        <SectionLabel>Login email</SectionLabel>
        <AppTextInput
          value={email}
          onChangeText={setEmail}
          placeholder="restaurant@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!saving}
        />

        <SectionLabel>Password</SectionLabel>
        <AppTextInput
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
        />

        <SectionLabel>Phone</SectionLabel>
        <AppTextInput value={phone} onChangeText={setPhone} placeholder="Optional" keyboardType="phone-pad" editable={!saving} />

        <SectionLabel>Address</SectionLabel>
        <AppTextInput value={addressText} onChangeText={setAddressText} placeholder="Optional" editable={!saving} />

        <SectionLabel>Service areas (comma-separated)</SectionLabel>
        <AppTextInput
          value={serviceAreas}
          onChangeText={setServiceAreas}
          placeholder="Baneshwor, New Baneshwor, Koteshwor"
          editable={!saving}
        />

        <SectionLabel>Currency</SectionLabel>
        <CurrencyChips value={currency} onChange={setCurrency} disabled={saving} />

        <CodToggle value={acceptsCod} onChange={setAcceptsCod} disabled={saving} />

        {error ? (
          <AppText variant="caption" color={colors.error} style={styles.formError}>
            {error}
          </AppText>
        ) : null}

        <Button
          label={saving ? 'Creating…' : 'Create partner'}
          onPress={() => void submit()}
          loading={saving}
          disabled={saving}
          style={styles.createBtn}
        />
      </ScrollView>
    </Sheet>
  );
}

/** Shown exactly once right after a create — the admin typed the password, but
 * this is the only screen that shows the finished login pair together so it
 * can be copied/handed to the restaurant before navigating away. */
function CredentialsSheet({ creds, onDone }: { creds: CreatedCreds | null; onDone: () => void }) {
  return (
    <Sheet visible={creds !== null} onClose={onDone} title="Partner created">
      {creds ? (
        <View style={styles.sheetScroll}>
          <AppText variant="body" color={colors.textDim}>
            Share this login with {creds.name} now — the password won&apos;t be shown again.
          </AppText>
          <View style={styles.credsBox}>
            <AppText variant="caption" color={colors.textFaint}>
              Login email
            </AppText>
            <AppText variant="bodyBold">{creds.email}</AppText>
            <AppText variant="caption" color={colors.textFaint} style={styles.credsGap}>
              Password
            </AppText>
            <AppText variant="bodyBold">{creds.password}</AppText>
          </View>
          <Button label="Done" onPress={onDone} style={styles.createBtn} />
        </View>
      ) : null}
    </Sheet>
  );
}

// ════════════════════════════════════════════════════════════════
// Edit sheet
// ════════════════════════════════════════════════════════════════

function EditSheet({
  partner,
  token,
  onClose,
  onSaved,
  onDeactivated,
  reauthGuard,
}: {
  partner: PartnerRow | null;
  token: string;
  onClose: () => void;
  onSaved: () => void;
  onDeactivated: () => void;
  reauthGuard: (fn: () => void) => void;
}) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [addressText, setAddressText] = useState('');
  const [serviceAreas, setServiceAreas] = useState('');
  const [acceptsCod, setAcceptsCod] = useState(true);
  const [currency, setCurrency] = useState<'NPR' | 'USD'>('NPR');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    if (!partner) return;
    setName(partner.name);
    setContact(partner.contact);
    setPhone(partner.phone);
    setAddressText(partner.addressText);
    setServiceAreas(partner.serviceAreas.join(', '));
    setAcceptsCod(partner.acceptsCod);
    setCurrency(partner.currency === 'USD' ? 'USD' : 'NPR');
    setError(null);
    setConfirmDeactivate(false);
  }, [partner]);

  function close(): void {
    if (saving || busy) return;
    onClose();
  }

  async function save(): Promise<void> {
    if (!partner || saving) return;
    if (!name.trim()) {
      setError('Restaurant name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const patch: PartnerPatch = {
      name: name.trim(),
      contact: contact.trim(),
      phone: phone.trim(),
      addressText: addressText.trim(),
      serviceAreas: parseServiceAreas(serviceAreas),
      acceptsCod,
      currency,
    };
    try {
      await updatePartner(partner.id, patch, token);
      setSaving(false);
      onSaved();
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
      setSaving(false);
    }
  }

  async function doDeactivate(): Promise<void> {
    if (!partner) return;
    setBusy(true);
    setError(null);
    try {
      await deactivatePartner(partner.id, token);
      setBusy(false);
      onDeactivated();
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
      setBusy(false);
    }
  }

  async function reactivate(): Promise<void> {
    if (!partner) return;
    setBusy(true);
    setError(null);
    try {
      await updatePartner(partner.id, { isActive: true }, token);
      setBusy(false);
      onDeactivated(); // reuses the same "refresh + close" path
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
      setBusy(false);
    }
  }

  return (
    <Sheet visible={partner !== null} onClose={close} title={partner?.name ?? 'Partner'}>
      {partner ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
          <View style={styles.statusRow}>
            <Tag
              label={partner.isActive ? 'Active' : 'Deactivated'}
              variant={partner.isActive ? 'dim' : 'outline'}
              color={partner.isActive ? colors.textDim : colors.warning}
            />
            <AppText variant="caption" color={colors.textFaint} numberOfLines={1} style={styles.statusEmail}>
              {partner.email}
            </AppText>
          </View>

          <SectionLabel>Restaurant name</SectionLabel>
          <AppTextInput value={name} onChangeText={setName} editable={!saving && !busy} />

          <SectionLabel>Contact person</SectionLabel>
          <AppTextInput value={contact} onChangeText={setContact} editable={!saving && !busy} />

          <SectionLabel>Phone</SectionLabel>
          <AppTextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!saving && !busy} />

          <SectionLabel>Address</SectionLabel>
          <AppTextInput value={addressText} onChangeText={setAddressText} editable={!saving && !busy} />

          <SectionLabel>Service areas (comma-separated)</SectionLabel>
          <AppTextInput
            value={serviceAreas}
            onChangeText={setServiceAreas}
            placeholder="Baneshwor, New Baneshwor, Koteshwor"
            editable={!saving && !busy}
          />

          <SectionLabel>Currency</SectionLabel>
          <CurrencyChips value={currency} onChange={setCurrency} disabled={saving || busy} />

          <CodToggle value={acceptsCod} onChange={setAcceptsCod} disabled={saving || busy} />

          {error ? (
            <AppText variant="caption" color={colors.error} style={styles.formError}>
              {error}
            </AppText>
          ) : null}

          <Button
            label={saving ? 'Saving…' : 'Save changes'}
            onPress={() => void save()}
            loading={saving}
            disabled={saving || busy}
            style={styles.createBtn}
          />

          <View style={styles.dangerZone}>
            {partner.isActive ? (
              <>
                <AppText variant="caption" color={colors.textFaint}>
                  Deactivating ends every live session for this login immediately.
                </AppText>
                <Button
                  label={busy ? 'Deactivating…' : 'Deactivate partner'}
                  variant="danger"
                  onPress={() => setConfirmDeactivate(true)}
                  loading={busy}
                  disabled={saving || busy}
                  style={styles.dangerBtn}
                />
              </>
            ) : (
              <Button
                label={busy ? 'Reactivating…' : 'Reactivate partner'}
                variant="secondary"
                onPress={() => void reactivate()}
                loading={busy}
                disabled={saving || busy}
                style={styles.dangerBtn}
              />
            )}
          </View>
        </ScrollView>
      ) : null}

      <ConfirmDialog
        visible={confirmDeactivate}
        title="Deactivate partner?"
        message={`${partner?.name ?? 'This partner'} will lose all access and every live session ends immediately.`}
        confirmLabel="Deactivate"
        danger
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={() => {
          setConfirmDeactivate(false);
          reauthGuard(() => void doDeactivate());
        }}
      />
    </Sheet>
  );
}

// ════════════════════════════════════════════════════════════════
// Screen
// ════════════════════════════════════════════════════════════════

type StatusFilter = 'all' | 'active' | 'inactive';

export default function AdminPartnersScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'partners.manage');
  const reauth = useReauth();

  const [partners, setPartners] = useState<PartnerRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [creds, setCreds] = useState<CreatedCreds | null>(null);
  const [editing, setEditing] = useState<PartnerRow | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setPartners(await listPartnersAdmin(token));
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const filtered = useMemo(() => {
    if (!partners) return [];
    const q = query.trim().toLowerCase();
    return partners.filter((p) => {
      if (statusFilter === 'active' && !p.isActive) return false;
      if (statusFilter === 'inactive' && p.isActive) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
    });
  }, [partners, query, statusFilter]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  function handleCreated(next: CreatedCreds): void {
    setCreds(next);
    void load();
  }

  function closeEditAfterMutation(): void {
    setEditing(null);
    void load();
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can manage meal partners.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackRow onBack={goBack} />

      <View style={styles.searchRow}>
        <AppTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or email"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.filterRow}>
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'inactive', label: 'Deactivated' },
          ] as const
        ).map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={statusFilter === f.key}
            onPress={() => setStatusFilter(f.key)}
          />
        ))}
      </View>

      <Button label="New partner" onPress={() => setCreating(true)} style={styles.newBtn} />

      {loading && !partners ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && !partners ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : filtered.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          {partners && partners.length > 0 ? 'No partners match.' : 'No meal partners yet.'}
        </AppText>
      ) : (
        <View style={styles.list}>
          {filtered.map((p, i) => (
            <Animated.View key={p.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Edit ${p.name}`}
                onPress={() => setEditing(p)}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {p.name}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {p.email}
                  </AppText>
                  <View style={styles.rowTags}>
                    <Tag
                      label={p.isActive ? 'Active' : 'Deactivated'}
                      variant={p.isActive ? 'dim' : 'outline'}
                      color={p.isActive ? colors.textDim : colors.warning}
                    />
                    <Tag label={p.currency} variant="outline" color={colors.textFaint} />
                    {p.acceptsCod ? <Tag label="COD" variant="outline" color={colors.textFaint} /> : null}
                  </View>
                  <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                    {p.menuCount} menu item{p.menuCount === 1 ? '' : 's'} · {p.activeOrders} active order
                    {p.activeOrders === 1 ? '' : 's'}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      {token ? (
        <>
          <CreateSheet
            visible={creating}
            token={token}
            onClose={() => setCreating(false)}
            onCreated={handleCreated}
          />
          <CredentialsSheet creds={creds} onDone={() => setCreds(null)} />
          <EditSheet
            partner={editing}
            token={token}
            onClose={() => setEditing(null)}
            onSaved={closeEditAfterMutation}
            onDeactivated={closeEditAfterMutation}
            reauthGuard={reauth.guard}
          />
        </>
      ) : null}

      <ReauthSheet controller={reauth} />
    </Screen>
  );
}

/** Shared back row + revamp header (no native header — matches the app). */
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
      <ScreenHeader eyebrow="Admin console" title="Meal partners" style={styles.header} />
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
  searchRow: { marginBottom: spacing.sm },
  searchInput: { flex: 1 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  newBtn: { marginBottom: spacing.lg },
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
    padding: spacing.lg,
    minHeight: 64,
  },
  rowText: { flex: 1, gap: 2 },
  rowTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2, marginBottom: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  switch: {
    width: 52,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfacePressed,
    padding: 4,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.accent },
  knob: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignSelf: 'flex-start',
  },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.onBlock },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  formError: { marginTop: spacing.sm },
  createBtn: { marginTop: spacing.xl },
  credsBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  credsGap: { marginTop: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  statusEmail: { flex: 1 },
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceRaised,
    gap: spacing.sm,
  },
  dangerBtn: { marginTop: spacing.xs },
});
