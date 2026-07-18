'use client';

import { useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { GYM_AMENITIES, GYM_CATEGORIES, GYM_DAY_KEYS } from '@gym/shared';
import type { GymAmenity, GymCategory, GymDayKey, GymHoursShift, GymStatus, GymWeeklyHours } from '@gym/shared';
import {
  Badge,
  Button,
  ConfirmButton,
  DataTable,
  Modal,
  SearchField,
  TextField,
  Toolbar,
  type Column,
} from '@/components/console';
import type { LocationValue } from '@/components/console/LocationPicker';
import type { GymPhotoRow, GymRow, GymSocialLinkValue } from './types';

// Client-only: Leaflet touches `window` at import, so never SSR this.
const LocationPicker = dynamic(
  () => import('@/components/console/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 320,
          borderRadius: 10,
          border: '1px solid var(--gt-border)',
          background: 'var(--gt-surface-sunken)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--gt-text-dim)',
          fontSize: 13,
        }}
      >
        Loading map…
      </div>
    ),
  },
);

const DAY_LABEL: Record<GymDayKey, string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

const STATUS_TONE: Record<GymStatus, 'neutral' | 'positive' | 'warning'> = {
  draft: 'neutral',
  published: 'positive',
  archived: 'warning',
};

async function parseErrorCode(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

interface FormState {
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
  amenities: GymAmenity[];
  hours: GymWeeklyHours;
  socialLinks: GymSocialLinkValue[];
  status: GymStatus;
  verifiedByAdmin: boolean;
}

const EMPTY_FORM: FormState = {
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
  amenities: [],
  hours: {},
  socialLinks: [],
  status: 'draft',
  verifiedByAdmin: false,
};

function rowToForm(row: GymRow): FormState {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    addressText: row.addressText,
    city: row.city,
    district: row.district,
    lat: row.lat !== null ? String(row.lat) : '',
    lng: row.lng !== null ? String(row.lng) : '',
    phone: row.phone,
    website: row.website ?? '',
    priceNote: row.priceNote,
    description: row.description,
    externalImageUrl: row.externalImageUrl ?? '',
    amenities: row.amenities,
    hours: row.hours,
    socialLinks: row.socialLinks,
    status: row.status,
    verifiedByAdmin: row.verifiedByAdmin,
  };
}

/**
 * Nearby-gyms admin CRUD (plan §4/§7 P7). Every gym row is loaded server-side
 * with its photos already joined; this component only owns the create/edit
 * form and the mutation calls to the guarded /api/admin/gyms/* routes.
 * `router.refresh()` after every successful mutation re-runs the server
 * component load — no separate client-side cache to keep in sync.
 */
export function GymsManager({ gyms }: { gyms: GymRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<GymStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GymRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bridge the string-typed form coords to the picker's numeric value. Only a
  // fully-valid pair becomes a pin; anything else leaves the map empty.
  const parsedLat = Number(form.lat);
  const parsedLng = Number(form.lng);
  const locationValue: LocationValue | null =
    form.lat.trim() &&
    form.lng.trim() &&
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180
      ? { lat: parsedLat, lng: parsedLng }
      : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return gyms.filter((g) => {
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || g.city.toLowerCase().includes(q) || g.slug.includes(q);
    });
  }, [gyms, query, statusFilter]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(row: GymRow) {
    setEditing(row);
    setForm(rowToForm(row));
    setError(null);
    setModalOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (form.status === 'published' && !form.verifiedByAdmin) {
      setError('Mark this listing verified before publishing it.');
      return;
    }
    const lat = form.lat.trim() ? Number(form.lat) : null;
    const lng = form.lng.trim() ? Number(form.lng) : null;
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
      setError('Latitude/longitude must be numbers.');
      return;
    }

    setSaving(true);
    setError(null);

    const shared = {
      name: form.name.trim(),
      category: form.category,
      addressText: form.addressText.trim(),
      city: form.city.trim(),
      district: form.district.trim(),
      lat,
      lng,
      phone: form.phone.trim(),
      website: form.website.trim() || null,
      socialLinks: form.socialLinks.filter((s) => s.platform.trim() && s.url.trim()),
      hours: form.hours,
      amenities: form.amenities,
      externalImageUrl: form.externalImageUrl.trim() || null,
      priceNote: form.priceNote.trim(),
      description: form.description.trim(),
    };

    try {
      const res = editing
        ? await fetch(`/api/admin/gyms/${encodeURIComponent(editing.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              ...shared,
              status: form.status,
              verifiedByAdmin: form.verifiedByAdmin,
            }),
          })
        : await fetch('/api/admin/gyms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              ...shared,
              slug: form.slug.trim() || undefined,
            }),
          });

      if (!res.ok) {
        const code = await parseErrorCode(res);
        setError(
          code === 'slug_taken'
            ? 'That slug is already in use.'
            : code === 'must_verify_before_publish'
              ? 'Mark this listing verified before publishing it.'
              : res.status === 403
                ? 'You are not allowed to manage gyms.'
                : 'Could not save that listing.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setModalOpen(false);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  const columns: Column<GymRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
    { key: 'city', header: 'City', render: (r) => r.city || <span style={{ color: 'var(--gt-text-dim)' }}>—</span> },
    { key: 'category', header: 'Category', render: (r) => r.category.replace('_', ' ') },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
    },
    {
      key: 'verified',
      header: 'Verified',
      align: 'center',
      render: (r) => (r.verifiedByAdmin ? '✓' : <span style={{ color: 'var(--gt-text-dim)' }}>—</span>),
    },
    {
      key: 'photos',
      header: 'Photos',
      align: 'right',
      render: (r) => <span className="gt-numeric">{r.photos.length}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 100,
      align: 'right',
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <Toolbar
        left={
          <SearchField
            placeholder="Search by name, city, or slug…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        right={
          <>
            <select
              className="gt-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as GymStatus | 'all')}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
            <Button variant="primary" onClick={openCreate}>
              New gym
            </Button>
          </>
        }
      />
      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} empty="No gyms yet." />

      <Modal
        open={modalOpen}
        onClose={() => (saving ? undefined : setModalOpen(false))}
        title={editing ? `Edit ${editing.name}` : 'New gym'}
        width={720}
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!editing ? (
            <TextField
              label="Slug (optional — auto-generated from name if blank)"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              disabled={saving}
            />
          ) : null}

          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            disabled={saving}
          />

          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <FieldLabel>Category</FieldLabel>
              <select
                className="gt-input"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as GymCategory }))}
                disabled={saving}
              >
                {GYM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <TextField
              label="Website"
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
              placeholder="https://…"
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Address"
              value={form.addressText}
              onChange={(e) => setForm((f) => ({ ...f, addressText: e.target.value }))}
              disabled={saving}
              style={{ flex: 2 }}
            />
            <TextField
              label="City"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <TextField
              label="District"
              value={form.district}
              onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
              disabled={saving}
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <FieldLabel>Location on map</FieldLabel>
            <LocationPicker
              mode="pin"
              value={locationValue}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  lat: v ? String(v.lat) : '',
                  lng: v ? String(v.lng) : '',
                }))
              }
              disabled={saving}
              ariaLabel="Gym location"
            />
          </div>

          <TextField
            label="Price note"
            value={form.priceNote}
            onChange={(e) => setForm((f) => ({ ...f, priceNote: e.target.value }))}
            disabled={saving}
            placeholder="e.g. Rs 3,000/month"
          />

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <FieldLabel>Description</FieldLabel>
            <textarea
              className="gt-input"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={saving}
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </label>

          <TextField
            label="Operator-supplied image URL (not verified by us)"
            hint="A photo the gym operator sent us — never a scraped/hotlinked image. Prefer uploading real photos below."
            value={form.externalImageUrl}
            onChange={(e) => setForm((f) => ({ ...f, externalImageUrl: e.target.value }))}
            disabled={saving}
            placeholder="https://…"
          />

          <AmenitiesEditor
            value={form.amenities}
            onChange={(amenities) => setForm((f) => ({ ...f, amenities }))}
            disabled={saving}
          />

          <HoursEditor
            value={form.hours}
            onChange={(hours) => setForm((f) => ({ ...f, hours }))}
            disabled={saving}
          />

          <SocialLinksEditor
            value={form.socialLinks}
            onChange={(socialLinks) => setForm((f) => ({ ...f, socialLinks }))}
            disabled={saving}
          />

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <FieldLabel>Status</FieldLabel>
              <select
                className="gt-input"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as GymStatus }))}
                disabled={saving}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minHeight: 40,
                fontSize: 13,
                color: 'var(--gt-text-dim)',
              }}
            >
              <input
                type="checkbox"
                checked={form.verifiedByAdmin}
                onChange={(e) => setForm((f) => ({ ...f, verifiedByAdmin: e.target.checked }))}
                disabled={saving}
              />
              Verified by admin
            </label>
          </div>
          {form.status === 'published' && !form.verifiedByAdmin ? (
            <div style={{ fontSize: 12, color: 'var(--gt-warning)' }}>
              This listing can&apos;t go live as Published until it&apos;s marked verified.
            </div>
          ) : null}

          {editing ? <PhotosEditor gymId={editing.id} photos={editing.photos} /> : null}

          {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
        </div>
      </Modal>
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 12,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: 'var(--gt-text-dim)',
        fontFamily: 'var(--font-heading)',
      }}
    >
      {children}
    </span>
  );
}

// ── Amenities ────────────────────────────────────────────────────────────

function AmenitiesEditor({
  value,
  onChange,
  disabled,
}: {
  value: GymAmenity[];
  onChange: (v: GymAmenity[]) => void;
  disabled: boolean;
}) {
  function toggle(a: GymAmenity) {
    onChange(value.includes(a) ? value.filter((v) => v !== a) : [...value, a]);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FieldLabel>Amenities</FieldLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {GYM_AMENITIES.map((a) => (
          <label
            key={a}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gt-text)' }}
          >
            <input type="checkbox" checked={value.includes(a)} onChange={() => toggle(a)} disabled={disabled} />
            {a.replace('_', ' ')}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Hours ────────────────────────────────────────────────────────────────

function HoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: GymWeeklyHours;
  onChange: (v: GymWeeklyHours) => void;
  disabled: boolean;
}) {
  function setShifts(day: GymDayKey, shifts: GymHoursShift[]) {
    const next = { ...value };
    if (shifts.length === 0) delete next[day];
    else next[day] = shifts;
    onChange(next);
  }

  function addShift(day: GymDayKey) {
    setShifts(day, [...(value[day] ?? []), { open: '06:00', close: '21:00' }]);
  }

  function updateShift(day: GymDayKey, i: number, field: 'open' | 'close', v: string) {
    const shifts = [...(value[day] ?? [])];
    shifts[i] = { ...shifts[i], [field]: v };
    setShifts(day, shifts);
  }

  function removeShift(day: GymDayKey, i: number) {
    const shifts = [...(value[day] ?? [])];
    shifts.splice(i, 1);
    setShifts(day, shifts);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FieldLabel>Weekly hours (blank day = closed)</FieldLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {GYM_DAY_KEYS.map((day) => {
          const shifts = value[day] ?? [];
          return (
            <div
              key={day}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--gt-border)',
              }}
            >
              <span style={{ width: 36, fontSize: 12, fontWeight: 600, paddingTop: 8 }}>{DAY_LABEL[day]}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                {shifts.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', paddingTop: 8 }}>Closed</span>
                ) : (
                  shifts.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="time"
                        className="gt-input"
                        value={s.open}
                        onChange={(e) => updateShift(day, i, 'open', e.target.value)}
                        disabled={disabled}
                        style={{ width: 110 }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>to</span>
                      <input
                        type="time"
                        className="gt-input"
                        value={s.close}
                        onChange={(e) => updateShift(day, i, 'close', e.target.value)}
                        disabled={disabled}
                        style={{ width: 110 }}
                      />
                      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => removeShift(day, i)}>
                        Remove
                      </Button>
                    </div>
                  ))
                )}
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => addShift(day)}>
                  + Add shift
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Social links ─────────────────────────────────────────────────────────

function SocialLinksEditor({
  value,
  onChange,
  disabled,
}: {
  value: GymSocialLinkValue[];
  onChange: (v: GymSocialLinkValue[]) => void;
  disabled: boolean;
}) {
  function update(i: number, field: 'platform' | 'url', v: string) {
    const next = [...value];
    next[i] = { ...next[i], [field]: v };
    onChange(next);
  }
  function remove(i: number) {
    const next = [...value];
    next.splice(i, 1);
    onChange(next);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FieldLabel>Social links</FieldLabel>
      {value.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input
            className="gt-input"
            placeholder="Instagram"
            value={s.platform}
            onChange={(e) => update(i, 'platform', e.target.value)}
            disabled={disabled}
            style={{ width: 130 }}
          />
          <input
            className="gt-input"
            placeholder="https://…"
            value={s.url}
            onChange={(e) => update(i, 'url', e.target.value)}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => remove(i)}>
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...value, { platform: '', url: '' }])}
      >
        + Add link
      </Button>
    </div>
  );
}

// ── Photos ───────────────────────────────────────────────────────────────

/** Reservation shape returned by POST /api/uploads/image. */
interface UploadReservation {
  uploadUrl: string;
  fields: Record<string, string>;
  uid: string;
  deliveryUrl?: string;
}

function PhotosEditor({ gymId, photos }: { gymId: string; photos: GymPhotoRow[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Local ordering lets Move up/down feel instant; refresh() reconciles after.
  const [order, setOrder] = useState<GymPhotoRow[]>(photos);

  async function persistOrder(next: GymPhotoRow[]) {
    setOrder(next);
    try {
      await fetch(`/api/admin/gyms/${encodeURIComponent(gymId)}/photos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order: next.map((p) => p.id) }),
      });
      router.refresh();
    } catch {
      setLocalError('Could not save the new order.');
    }
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    void persistOrder(next);
  }

  async function handleFile(file: File) {
    setUploading(true);
    setLocalError(null);
    try {
      const reserveRes = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind: 'gym_photo' }),
      });
      if (!reserveRes.ok) {
        setLocalError(
          reserveRes.status === 403
            ? 'You are not allowed to upload gym photos.'
            : 'Could not start the upload.',
        );
        return;
      }
      const reservation = (await reserveRes.json()) as UploadReservation;
      if (!reservation.deliveryUrl) {
        setLocalError('Upload was not configured for public delivery.');
        return;
      }

      const form = new FormData();
      for (const [k, v] of Object.entries(reservation.fields)) form.append(k, v);
      form.append('file', file);
      const cloudRes = await fetch(reservation.uploadUrl, { method: 'POST', body: form });
      if (!cloudRes.ok) {
        setLocalError('Image upload failed — try again.');
        return;
      }

      const attachRes = await fetch(`/api/admin/gyms/${encodeURIComponent(gymId)}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ uid: reservation.uid, deliveryUrl: reservation.deliveryUrl }),
      });
      if (!attachRes.ok) {
        setLocalError('Uploaded, but could not attach the photo — try again.');
        return;
      }
      const attached = (await attachRes.json()) as { photo?: GymPhotoRow };
      if (attached.photo) {
        setOrder((o) => [...o, attached.photo as GymPhotoRow]);
      }
      router.refresh();
    } catch {
      setLocalError('Network error during upload.');
    } finally {
      setUploading(false);
    }
  }

  async function remove(photoId: string) {
    setBusyId(photoId);
    setLocalError(null);
    try {
      const res = await fetch(
        `/api/admin/gyms/${encodeURIComponent(gymId)}/photos/${encodeURIComponent(photoId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        setLocalError('Could not delete that photo.');
        setBusyId(null);
        return;
      }
      setOrder((o) => o.filter((p) => p.id !== photoId));
      router.refresh();
    } catch {
      setLocalError('Network error.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldLabel>Photos ({order.length})</FieldLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {order.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px solid var(--gt-border)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.deliveryUrl}
              alt=""
              width={56}
              height={56}
              style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
            />
            <span style={{ flex: 1, fontSize: 12, color: 'var(--gt-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.deliveryUrl}
            </span>
            <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </Button>
            <Button variant="ghost" size="sm" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
              ↓
            </Button>
            <ConfirmButton label="Delete" confirmLabel="Confirm?" size="sm" busy={busyId === p.id} onConfirm={() => void remove(p.id)} />
          </div>
        ))}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
      <Button variant="ghost" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
        {uploading ? 'Uploading…' : '+ Upload photo'}
      </Button>
      {localError ? <div style={{ color: 'var(--gt-danger)', fontSize: 12 }}>{localError}</div> : null}
    </div>
  );
}
