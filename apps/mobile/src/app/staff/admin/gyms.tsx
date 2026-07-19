import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GYM_CATEGORIES, type GymCategory } from '@gym/shared';
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
  Tag,
} from '../../../components/ui';
import {
  listGymsAdmin,
  setGymStatus,
  toStaffError,
  upsertGymAdmin,
  type GymInput,
  type GymRow,
  type GymStatus,
  type StaffErrorCode,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Nearby gyms (`gyms.manage` — super/main only, no sub-role preset).
 * Mobile parity C (N3): roster + create/edit the core listing fields +
 * publish/unpublish and the verified toggle. Deliberately mobile-scoped vs.
 * the web console:
 *  - No map picker (Leaflet is web-only) — lat/lng are plain numeric fields.
 *  - Amenities / weekly hours / social links stay web-only editors; omitting
 *    them from a PATCH here leaves those columns untouched server-side (the
 *    route only writes keys present in the body), so this screen can safely
 *    edit a subset of fields without clobbering the rest.
 *  - Photos are VIEW-only (a count) — uploads stay a web-only flow.
 * Publish/verify is a SEPARATE action from core-field edits, matching the
 * two distinct API calls (`upsertGymAdmin` vs `setGymStatus`): saving core
 * fields never changes status/verified, and vice versa.
 */

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired — sign in again.';
    case 'forbidden':
      return "You don't have access to manage gyms.";
    case 'not_found':
      return 'That gym no longer exists.';
    case 'conflict':
      return 'That slug is already in use.';
    case 'invalid':
      return "Mark this listing verified before publishing it, or check the fields.";
    default:
      return "Couldn't reach the server. Try again.";
  }
}

const STATUS_LABEL: Record<GymStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

const STATUS_COLOR: Record<GymStatus, string> = {
  draft: colors.textFaint,
  published: colors.success,
  archived: colors.warning,
};

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

interface CoreFormState {
  slug: string;
  name: string;
  category: GymCategory;
  addressText: string;
  city: string;
  district: string;
  lat: string;
  lng: string;
  phone: string;
  website: string;
  priceNote: string;
  description: string;
  externalImageUrl: string;
}

const EMPTY_FORM: CoreFormState = {
  slug: '',
  name: '',
  category: 'gym',
  addressText: '',
  city: '',
  district: '',
  lat: '',
  lng: '',
  phone: '',
  website: '',
  priceNote: '',
  description: '',
  externalImageUrl: '',
};

function rowToForm(row: GymRow): CoreFormState {
  return {
    slug: row.slug,
    name: row.name,
    category: GYM_CATEGORIES.includes(row.category as GymCategory)
      ? (row.category as GymCategory)
      : 'other',
    addressText: row.addressText,
    city: row.city,
    district: row.district,
    lat: row.lat != null ? String(row.lat) : '',
    lng: row.lng != null ? String(row.lng) : '',
    phone: row.phone,
    website: row.website ?? '',
    priceNote: row.priceNote,
    description: row.description,
    externalImageUrl: row.externalImageUrl ?? '',
  };
}

function CoreFields({
  form,
  setForm,
  disabled,
  showSlug,
}: {
  form: CoreFormState;
  setForm: (updater: (f: CoreFormState) => CoreFormState) => void;
  disabled: boolean;
  showSlug: boolean;
}) {
  return (
    <>
      {showSlug ? (
        <>
          <SectionLabel>Slug (optional — auto-generated from name)</SectionLabel>
          <AppTextInput
            value={form.slug}
            onChangeText={(v) => setForm((f) => ({ ...f, slug: v }))}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
        </>
      ) : null}

      <SectionLabel>Name</SectionLabel>
      <AppTextInput
        value={form.name}
        onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
        editable={!disabled}
      />

      <SectionLabel>Category</SectionLabel>
      <View style={styles.chips}>
        {GYM_CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={c.replace('_', ' ')}
            selected={form.category === c}
            onPress={() => !disabled && setForm((f) => ({ ...f, category: c }))}
          />
        ))}
      </View>

      <SectionLabel>Address</SectionLabel>
      <AppTextInput
        value={form.addressText}
        onChangeText={(v) => setForm((f) => ({ ...f, addressText: v }))}
        editable={!disabled}
      />

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <SectionLabel>City</SectionLabel>
          <AppTextInput
            value={form.city}
            onChangeText={(v) => setForm((f) => ({ ...f, city: v }))}
            editable={!disabled}
          />
        </View>
        <View style={styles.fieldHalf}>
          <SectionLabel>District</SectionLabel>
          <AppTextInput
            value={form.district}
            onChangeText={(v) => setForm((f) => ({ ...f, district: v }))}
            editable={!disabled}
          />
        </View>
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <SectionLabel>Latitude</SectionLabel>
          <AppTextInput
            value={form.lat}
            onChangeText={(v) => setForm((f) => ({ ...f, lat: v }))}
            keyboardType="numbers-and-punctuation"
            editable={!disabled}
            placeholder="Optional"
          />
        </View>
        <View style={styles.fieldHalf}>
          <SectionLabel>Longitude</SectionLabel>
          <AppTextInput
            value={form.lng}
            onChangeText={(v) => setForm((f) => ({ ...f, lng: v }))}
            keyboardType="numbers-and-punctuation"
            editable={!disabled}
            placeholder="Optional"
          />
        </View>
      </View>

      <SectionLabel>Phone</SectionLabel>
      <AppTextInput
        value={form.phone}
        onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
        keyboardType="phone-pad"
        editable={!disabled}
      />

      <SectionLabel>Website</SectionLabel>
      <AppTextInput
        value={form.website}
        onChangeText={(v) => setForm((f) => ({ ...f, website: v }))}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://…"
        editable={!disabled}
      />

      <SectionLabel>Price note</SectionLabel>
      <AppTextInput
        value={form.priceNote}
        onChangeText={(v) => setForm((f) => ({ ...f, priceNote: v }))}
        placeholder="e.g. Rs 3,000/month"
        editable={!disabled}
      />

      <SectionLabel>Description</SectionLabel>
      <AppTextInput
        value={form.description}
        onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
        multiline
        numberOfLines={3}
        style={styles.multiline}
        editable={!disabled}
      />

      <SectionLabel>Operator-supplied image URL</SectionLabel>
      <AppTextInput
        value={form.externalImageUrl}
        onChangeText={(v) => setForm((f) => ({ ...f, externalImageUrl: v }))}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://… (never a scraped image)"
        editable={!disabled}
      />
    </>
  );
}

function parseCoreForm(form: CoreFormState): { fields: GymInput; error: string | null } {
  if (!form.name.trim()) return { fields: {}, error: 'Name is required.' };
  const lat = form.lat.trim() ? Number(form.lat) : null;
  const lng = form.lng.trim() ? Number(form.lng) : null;
  if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
    return { fields: {}, error: 'Latitude/longitude must be numbers.' };
  }
  return {
    error: null,
    fields: {
      name: form.name.trim(),
      category: form.category,
      addressText: form.addressText.trim(),
      city: form.city.trim(),
      district: form.district.trim(),
      lat,
      lng,
      phone: form.phone.trim(),
      website: form.website.trim() || null,
      priceNote: form.priceNote.trim(),
      description: form.description.trim(),
      externalImageUrl: form.externalImageUrl.trim() || null,
    },
  };
}

// ════════════════════════════════════════════════════════════════
// Create sheet
// ════════════════════════════════════════════════════════════════

function CreateSheet({
  visible,
  token,
  onClose,
  onCreated,
}: {
  visible: boolean;
  token: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CoreFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    if (saving) return;
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }

  async function submit(): Promise<void> {
    if (saving) return;
    const { fields, error: validationError } = parseCoreForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertGymAdmin({ ...fields, slug: form.slug.trim() || undefined }, token);
      setForm(EMPTY_FORM);
      onClose();
      onCreated();
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={close} title="New gym">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
        <AppText variant="caption" color={colors.textDim}>
          New listings are always created as a draft, unverified — publish it
          from the roster once it&apos;s ready.
        </AppText>
        <CoreFields form={form} setForm={setForm} disabled={saving} showSlug />
        {error ? (
          <AppText variant="caption" color={colors.error} style={styles.formError}>
            {error}
          </AppText>
        ) : null}
        <Button
          label={saving ? 'Creating…' : 'Create gym'}
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
// Edit sheet
// ════════════════════════════════════════════════════════════════

function EditSheet({
  gym,
  token,
  onClose,
  onSaved,
}: {
  gym: GymRow | null;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CoreFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [status, setStatus] = useState<GymStatus>('draft');
  const [verified, setVerified] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!gym) return;
    setForm(rowToForm(gym));
    setSaveError(null);
    setStatus(gym.status);
    setVerified(gym.verifiedByAdmin);
    setStatusError(null);
  }, [gym]);

  function close(): void {
    if (saving || statusBusy) return;
    onClose();
  }

  async function save(): Promise<void> {
    if (!gym || saving) return;
    const { fields, error: validationError } = parseCoreForm(form);
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await upsertGymAdmin({ id: gym.id, ...fields }, token);
      setSaving(false);
      onSaved();
    } catch (err) {
      setSaveError(errorLine(toStaffError(err).code));
      setSaving(false);
    }
  }

  async function saveStatus(): Promise<void> {
    if (!gym || statusBusy) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      await setGymStatus(gym.id, status, token, verified);
      setStatusBusy(false);
      onSaved();
    } catch (err) {
      setStatusError(errorLine(toStaffError(err).code));
      setStatusBusy(false);
    }
  }

  const publishBlocked = status === 'published' && !verified;

  return (
    <Sheet visible={gym !== null} onClose={close} title={gym?.name ?? 'Gym'}>
      {gym ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
          <View style={styles.statusRow}>
            <Tag label={STATUS_LABEL[gym.status]} variant="outline" color={STATUS_COLOR[gym.status]} />
            {gym.verifiedByAdmin ? <Tag label="Verified" variant="dim" /> : null}
            <AppText variant="caption" color={colors.textFaint} style={styles.statusSlug} numberOfLines={1}>
              /{gym.slug}
            </AppText>
          </View>

          <SectionLabel>Core details</SectionLabel>
          <CoreFields form={form} setForm={setForm} disabled={saving} showSlug={false} />

          {saveError ? (
            <AppText variant="caption" color={colors.error} style={styles.formError}>
              {saveError}
            </AppText>
          ) : null}

          <Button
            label={saving ? 'Saving…' : 'Save details'}
            onPress={() => void save()}
            loading={saving}
            disabled={saving || statusBusy}
            style={styles.createBtn}
          />

          <View style={styles.dangerZone}>
            <SectionLabel>Status & visibility</SectionLabel>
            <View style={styles.chips}>
              {(['draft', 'published', 'archived'] as const).map((s) => (
                <Chip
                  key={s}
                  label={STATUS_LABEL[s]}
                  selected={status === s}
                  onPress={() => !statusBusy && setStatus(s)}
                />
              ))}
            </View>
            <PressableScale
              accessibilityRole="switch"
              accessibilityState={{ checked: verified, disabled: statusBusy }}
              accessibilityLabel="Verified by admin"
              onPress={() => !statusBusy && setVerified((v) => !v)}
              style={styles.toggleRow}
            >
              <AppText variant="body">Verified by admin</AppText>
              <View style={[styles.switch, verified && styles.switchOn]}>
                <View style={[styles.knob, verified && styles.knobOn]} />
              </View>
            </PressableScale>
            {publishBlocked ? (
              <AppText variant="caption" color={colors.warning}>
                This listing can&apos;t go live as Published until it&apos;s marked verified.
              </AppText>
            ) : null}
            {statusError ? (
              <AppText variant="caption" color={colors.error}>
                {statusError}
              </AppText>
            ) : null}
            <Button
              label={statusBusy ? 'Updating…' : 'Update status'}
              variant="secondary"
              onPress={() => void saveStatus()}
              loading={statusBusy}
              disabled={saving || statusBusy}
              style={styles.dangerBtn}
            />
          </View>

          <View style={styles.dangerZone}>
            <SectionLabel>Photos</SectionLabel>
            <AppText variant="caption" color={colors.textFaint}>
              {gym.photoCount} photo{gym.photoCount === 1 ? '' : 's'} attached. Upload and reorder
              from the web admin console — photo management stays web-only.
            </AppText>
          </View>
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

// ════════════════════════════════════════════════════════════════
// Screen
// ════════════════════════════════════════════════════════════════

type StatusFilter = 'all' | GymStatus;

export default function AdminGymsScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'gyms.manage');

  const [gyms, setGyms] = useState<GymRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GymRow | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setGyms(await listGymsAdmin(token));
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
    if (!gyms) return [];
    const q = query.trim().toLowerCase();
    return gyms.filter((g) => {
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.city.toLowerCase().includes(q) ||
        g.slug.toLowerCase().includes(q)
      );
    });
  }, [gyms, query, statusFilter]);

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  function afterMutation(): void {
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
            Only a super admin or main admin can manage gyms.
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
          placeholder="Search by name, city, or slug"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.filterRow}>
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'draft', label: 'Draft' },
            { key: 'published', label: 'Published' },
            { key: 'archived', label: 'Archived' },
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

      <Button label="New gym" onPress={() => setCreating(true)} style={styles.newBtn} />

      {loading && !gyms ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && !gyms ? (
        <View style={styles.retryWrap}>
          <RetryLine message={error} onRetry={() => void load()} />
        </View>
      ) : filtered.length === 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={styles.emptyLine}>
          {gyms && gyms.length > 0 ? 'No gyms match.' : 'No gyms yet.'}
        </AppText>
      ) : (
        <View style={styles.list}>
          {filtered.map((g, i) => (
            <Animated.View key={g.id} entering={enterUp(Math.min(i, 6))}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Edit ${g.name}`}
                onPress={() => setEditing(g)}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {g.name}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {g.city || 'No city set'} · {g.category.replace('_', ' ')}
                  </AppText>
                  <View style={styles.rowTags}>
                    <Tag label={STATUS_LABEL[g.status]} variant="outline" color={STATUS_COLOR[g.status]} />
                    {g.verifiedByAdmin ? <Tag label="Verified" variant="dim" /> : null}
                    <Tag
                      label={`${g.photoCount} photo${g.photoCount === 1 ? '' : 's'}`}
                      variant="outline"
                      color={colors.textFaint}
                    />
                  </View>
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
            onCreated={() => void load()}
          />
          <EditSheet gym={editing} token={token} onClose={() => setEditing(null)} onSaved={afterMutation} />
        </>
      ) : null}
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
      <ScreenHeader eyebrow="Admin console" title="Nearby gyms" style={styles.header} />
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
  rowTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fieldRow: { flexDirection: 'row', gap: spacing.md },
  fieldHalf: { flex: 1 },
  multiline: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  statusSlug: { flex: 1 },
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceRaised,
    gap: spacing.sm,
  },
  dangerBtn: { marginTop: spacing.xs },
});
