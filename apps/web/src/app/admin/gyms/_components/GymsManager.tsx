'use client';

import { useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  GYM_AMENITIES,
  GYM_CATEGORIES,
  GYM_CROWD_LEVELS,
  GYM_DAY_KEYS,
  GYM_EQUIPMENT_CATEGORIES,
  GYM_PASS_TYPES,
  gymCrowdStatusSchema,
  gymEquipmentItemSchema,
  gymPassOptionSchema,
} from '@gym/shared';
import type {
  GymAmenity,
  GymCategory,
  GymCrowdLevel,
  GymCrowdStatus,
  GymDayKey,
  GymEquipmentCategory,
  GymEquipmentItem,
  GymHoursShift,
  GymPassOption,
  GymPassType,
  GymStatus,
  GymWeeklyHours,
} from '@gym/shared';
import {
  Badge,
  Button,
  ConfirmButton,
  DataTable,
  Modal,
  SearchField,
  TableThumb,
  TextField,
  Toolbar,
  type Column,
} from '@/components/console';
import type { LocationValue } from '@/components/console/LocationPicker';
import { QueueTabs } from '../../_components/QueueTabs';
import { useUrlSearch, useUrlState } from '../../_components/useUrlState';
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
          borderRadius: 'var(--gt-radius-sm)',
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

/**
 * What each state means to the person editing it, rather than the word stored
 * in the column. The table used to print `draft` and `published` straight out
 * of the database, and the category cell swapped the underscore in
 * `health_club` for a space and called it a label.
 */
const STATUS_LABEL: Record<GymStatus, string> = {
  draft: 'Draft',
  published: 'Live',
  archived: 'Archived',
};

const CATEGORY_LABEL: Record<GymCategory, string> = {
  gym: 'Gym',
  health_club: 'Health club',
  studio: 'Studio',
  crossfit: 'CrossFit',
  yoga: 'Yoga',
  other: 'Other',
};

const STATUS_TABS: readonly { key: GymStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Live' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Archived' },
];

/** Accepted `?status=` values; anything else falls back to All. */
const GYM_STATUS_FILTER_KEYS: readonly (GymStatus | 'all')[] = [
  'all',
  'published',
  'draft',
  'archived',
];

/** Same wording the member app uses for each equipment group. */
const EQUIPMENT_CATEGORY_LABEL: Record<GymEquipmentCategory, string> = {
  free_weights: 'Free weights',
  cardio: 'Cardio',
  machines: 'Machines',
  functional: 'Turf & functional',
  recovery: 'Recovery',
};

const CROWD_LEVEL_LABEL: Record<GymCrowdLevel, string> = {
  quiet: 'Quiet',
  moderate: 'Moderate',
  busy: 'Busy',
  packed: 'Packed',
};

const PASS_TYPE_LABEL: Record<GymPassType, string> = {
  day_pass: 'Day pass',
  weekly_pass: 'Weekly pass',
  monthly: 'Monthly',
  annual: 'Annual',
};

const HOURS_IN_DAY = 24;

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** priceMinor → an editable major-unit string (e.g. 50000 → "500", 999 → "9.99"). */
function toMajorInput(priceMinor: number): string {
  return (priceMinor / 100).toString();
}

/** Editable major-unit string → priceMinor. Blank/negative/NaN = not a price. */
function toMinor(major: string): number | null {
  if (major.trim() === '') return null;
  const n = Number(major);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

async function parseErrorCode(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

/**
 * Draft rows keep every number as a string while the admin is typing (a
 * half-typed "1" must not become a saved count of 1), then get parsed and
 * re-validated against the shared zod schemas in `save()` — the same schemas
 * the API routes enforce, so the console never posts something the server
 * would reject with a bare "invalid".
 */
interface EquipmentDraft {
  id: string;
  name: string;
  category: GymEquipmentCategory;
  count: string;
  description: string;
}

interface CrowdDraft {
  level: GymCrowdLevel;
  percentage: string;
  /** null = no hour-by-hour chart. Otherwise exactly 24 entries (00:00→23:00). */
  hourly: string[] | null;
  peakHoursText: string;
}

interface PassDraft {
  id: string;
  type: GymPassType;
  title: string;
  /** Major units (rupees/dollars) — converted to priceMinor on save. */
  price: string;
  currency: GymPassOption['currency'];
  /** Comma-separated list of what's included. */
  features: string;
  isPopular: boolean;
}

const EMPTY_CROWD: CrowdDraft = {
  level: 'moderate',
  percentage: '',
  hourly: null,
  peakHoursText: '',
};

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
  equipment: EquipmentDraft[];
  /** null = "No crowd data" — the default for every listing. */
  crowdData: CrowdDraft | null;
  passOptions: PassDraft[];
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
  equipment: [],
  crowdData: null,
  passOptions: [],
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
    equipment: row.equipment.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      count: e.count === undefined ? '' : String(e.count),
      description: e.description ?? '',
    })),
    crowdData: row.crowdData
      ? {
          level: row.crowdData.level,
          percentage: String(row.crowdData.percentage),
          hourly: row.crowdData.hourlyOccupancy
            ? row.crowdData.hourlyOccupancy.map((n) => String(n))
            : null,
          peakHoursText: row.crowdData.peakHoursText ?? '',
        }
      : null,
    passOptions: row.passOptions.map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      price: toMajorInput(p.priceMinor),
      currency: p.currency,
      features: p.features.join(', '),
      isPopular: p.isPopular ?? false,
    })),
    status: row.status,
    verifiedByAdmin: row.verifiedByAdmin,
  };
}

/**
 * Draft → validated payload. Each builder returns either the parsed value or a
 * plain-language message for the inline error line; nothing is guessed or
 * filled in on the admin's behalf, so a gym with no data keeps no data.
 */
type BuildResult<T> = { value: T } | { error: string };

function buildEquipment(drafts: EquipmentDraft[]): BuildResult<GymEquipmentItem[]> {
  const items: GymEquipmentItem[] = [];
  for (const d of drafts) {
    const name = d.name.trim();
    // Rows with no name are treated as never filled in (matches the hint under
    // the editor) rather than blocking the whole save.
    if (!name) continue;

    const countText = d.count.trim();
    let count: number | undefined;
    if (countText) {
      const n = Number(countText);
      if (!Number.isInteger(n) || n < 1 || n > 10_000) {
        return {
          error: `How many "${name}"? Use a whole number between 1 and 10,000, or leave it blank.`,
        };
      }
      count = n;
    }

    const parsed = gymEquipmentItemSchema.safeParse({
      id: d.id,
      name,
      category: d.category,
      ...(count === undefined ? {} : { count }),
      ...(d.description.trim() ? { description: d.description.trim() } : {}),
    });
    if (!parsed.success) {
      return { error: `Something in the "${name}" equipment row isn't valid. Please shorten it.` };
    }
    items.push(parsed.data);
  }
  return { value: items };
}

function buildCrowd(draft: CrowdDraft | null): BuildResult<GymCrowdStatus | null> {
  if (!draft) return { value: null };

  const pctText = draft.percentage.trim();
  if (!pctText) {
    return { error: 'Enter how full this gym usually is (0 to 100), or choose "No crowd data".' };
  }
  const percentage = Number(pctText);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return { error: 'How full the gym usually is must be a number between 0 and 100.' };
  }

  let hourlyOccupancy: number[] | undefined;
  if (draft.hourly) {
    // The member app draws all 24 bars or none, so a half-filled chart can't be
    // saved — it would either lie about the gaps or be rejected by the server.
    const numbers: number[] = [];
    for (let hour = 0; hour < draft.hourly.length; hour++) {
      const cell = draft.hourly[hour].trim();
      if (!cell) {
        return {
          error: `The hour-by-hour chart needs all 24 hours filled in, and ${hourLabel(hour)} is empty. Fill it in or remove the chart.`,
        };
      }
      const n = Number(cell);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { error: `${hourLabel(hour)} in the hour-by-hour chart must be a number between 0 and 100.` };
      }
      numbers.push(n);
    }
    hourlyOccupancy = numbers;
  }

  const parsed = gymCrowdStatusSchema.safeParse({
    level: draft.level,
    percentage,
    ...(hourlyOccupancy ? { hourlyOccupancy } : {}),
    ...(draft.peakHoursText.trim() ? { peakHoursText: draft.peakHoursText.trim() } : {}),
  });
  if (!parsed.success) {
    return { error: "Something in the busy-times section isn't valid. Please check it." };
  }
  return { value: parsed.data };
}

function buildPasses(drafts: PassDraft[]): BuildResult<GymPassOption[]> {
  const passes: GymPassOption[] = [];
  for (const d of drafts) {
    const title = d.title.trim();
    // Same rule as equipment: an unnamed row was never really filled in.
    if (!title) continue;

    const priceMinor = toMinor(d.price);
    if (priceMinor === null) {
      return { error: `Enter a price for "${title}". Numbers only, 0 or more.` };
    }

    const features = d.features
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    if (features.length > 20) {
      return { error: `"${title}" can list up to 20 things included.` };
    }

    const parsed = gymPassOptionSchema.safeParse({
      id: d.id,
      type: d.type,
      title,
      priceMinor,
      currency: d.currency,
      features,
      ...(d.isPopular ? { isPopular: true } : {}),
    });
    if (!parsed.success) {
      return { error: `Something in the "${title}" pass isn't valid. Please shorten it.` };
    }
    passes.push(parsed.data);
  }
  return { value: passes };
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
  // Both in the URL, so previewing a listing on the public site and coming
  // back returns to the same shortlist.
  const [query, setQuery] = useUrlSearch('q');
  const [statusFilter, setStatusFilter] = useUrlState<GymStatus | 'all'>(
    'status',
    'all',
    GYM_STATUS_FILTER_KEYS,
  );
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

    const equipment = buildEquipment(form.equipment);
    if ('error' in equipment) {
      setError(equipment.error);
      return;
    }
    const crowdData = buildCrowd(form.crowdData);
    if ('error' in crowdData) {
      setError(crowdData.error);
      return;
    }
    const passOptions = buildPasses(form.passOptions);
    if ('error' in passOptions) {
      setError(passOptions.error);
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
      equipment: equipment.value,
      crowdData: crowdData.value,
      passOptions: passOptions.value,
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
      setError('Could not reach us just now. Try again.');
      setSaving(false);
    }
  }

  const columns: Column<GymRow>[] = [
    // A listing is a picture and a place. The list showed neither: a name, a
    // city and a count of photos an operator had to open the row to see.
    {
      key: 'name',
      header: 'Listing',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <TableThumb
            src={r.photos[0]?.deliveryUrl ?? r.externalImageUrl ?? undefined}
            alt={r.name}
            size={44}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14 }}>
              {r.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--gt-text-dim)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {[r.city, r.district].filter(Boolean).join(' · ') || 'No city set'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Kind',
      width: 130,
      render: (r) => CATEGORY_LABEL[r.category] ?? r.category,
    },
    {
      key: 'status',
      header: 'Status',
      width: 190,
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {r.verifiedByAdmin ? <Badge tone="info">Checked</Badge> : null}
        </div>
      ),
    },
    // Photos are the whole point of a listing, so a listing without any says so
    // rather than showing a quiet zero next to the rows that have ten.
    {
      key: 'photos',
      header: 'Photos',
      width: 100,
      align: 'right',
      render: (r) =>
        r.photos.length === 0 ? (
          <span style={{ color: 'var(--gt-warning)', fontSize: 13 }}>None</span>
        ) : (
          <span className="gt-numeric">{r.photos.length}</span>
        ),
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
            <QueueTabs
              label="Which listings to show"
              tabs={STATUS_TABS}
              value={statusFilter}
              onChange={setStatusFilter}
              /* Neutral: this page's one accent belongs to New gym. */
              tone="neutral"
            />
            <Button variant="primary" onClick={openCreate}>
              New gym
            </Button>
          </>
        }
      />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        empty={
          query.trim() || statusFilter !== 'all' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <span>No listing matches this view.</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                }}
              >
                Show all listings
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <span>No gym listings yet.</span>
              <Button variant="ghost" size="sm" onClick={openCreate}>
                Add the first one
              </Button>
            </div>
          )
        }
      />

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
              label="Slug (optional, auto-generated from name if blank)"
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
                    {CATEGORY_LABEL[c] ?? c}
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
            hint="A photo the gym operator sent us, never a scraped/hotlinked image. Prefer uploading real photos below."
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

          <EquipmentEditor
            value={form.equipment}
            onChange={(equipment) => setForm((f) => ({ ...f, equipment }))}
            disabled={saving}
          />

          <CrowdEditor
            value={form.crowdData}
            onChange={(crowdData) => setForm((f) => ({ ...f, crowdData }))}
            disabled={saving}
          />

          <PassesEditor
            value={form.passOptions}
            onChange={(passOptions) => setForm((f) => ({ ...f, passOptions }))}
            disabled={saving}
          />

          {editing ? (
            <>
              {/* Status/Verified are edit-only: POST /api/admin/gyms always
                  creates draft+unverified server-side (a listing only goes
                  live via this PATCH path, once an editor has reviewed it) —
                  showing these controls during create let an admin "set"
                  Published/Verified on a new listing with no indication the
                  choice was never sent and silently discarded. Gating the
                  controls behind `editing` matches what the server actually
                  does and removes the silent drop. */}
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
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              New listings start as Draft and unverified. Save this one, then reopen it to
              mark it verified and publish it.
            </div>
          )}

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
                borderRadius: 'var(--gt-radius-sm)',
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

// ── Equipment ────────────────────────────────────────────────────────────

function EquipmentEditor({
  value,
  onChange,
  disabled,
}: {
  value: EquipmentDraft[];
  onChange: (v: EquipmentDraft[]) => void;
  disabled: boolean;
}) {
  function update(i: number, patch: Partial<EquipmentDraft>) {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    const next = [...value];
    next.splice(i, 1);
    onChange(next);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FieldLabel>Equipment</FieldLabel>
      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
        Only list kit the gym actually told us about. Members see this exactly as typed. Rows
        left without a name are dropped when you save.
      </span>
      {value.map((item, i) => (
        <div
          key={item.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid var(--gt-border)',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="gt-input"
              placeholder="Squat rack"
              aria-label="Equipment name"
              value={item.name}
              onChange={(e) => update(i, { name: e.target.value })}
              disabled={disabled}
              style={{ flex: 2 }}
            />
            <select
              className="gt-input"
              aria-label="Equipment group"
              value={item.category}
              onChange={(e) => update(i, { category: e.target.value as GymEquipmentCategory })}
              disabled={disabled}
              style={{ flex: 1 }}
            >
              {GYM_EQUIPMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EQUIPMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              className="gt-input"
              type="number"
              min={1}
              step={1}
              placeholder="How many"
              aria-label="How many (optional)"
              value={item.count}
              onChange={(e) => update(i, { count: e.target.value })}
              disabled={disabled}
              style={{ width: 110 }}
            />
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => remove(i)}>
              Remove
            </Button>
          </div>
          <input
            className="gt-input"
            placeholder="Short note (optional), e.g. 4 platforms with bumper plates"
            aria-label="Equipment note (optional)"
            value={item.description}
            onChange={(e) => update(i, { description: e.target.value })}
            disabled={disabled}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...value,
            { id: crypto.randomUUID(), name: '', category: 'free_weights', count: '', description: '' },
          ])
        }
      >
        + Add equipment
      </Button>
    </div>
  );
}

// ── How busy it gets ─────────────────────────────────────────────────────

/**
 * Crowd info is opt-in: "No crowd data" is the default and submits `null`, so
 * a listing never claims to know how busy a gym is until someone types it in.
 * The hour-by-hour chart is all-or-nothing — the shared schema (and the member
 * app's 24-bar chart) needs every hour, so a half-filled grid is refused
 * rather than padded with invented numbers.
 */
function CrowdEditor({
  value,
  onChange,
  disabled,
}: {
  value: CrowdDraft | null;
  onChange: (v: CrowdDraft | null) => void;
  disabled: boolean;
}) {
  function update(patch: Partial<CrowdDraft>) {
    if (!value) return;
    onChange({ ...value, ...patch });
  }
  function setHour(hour: number, cell: string) {
    if (!value?.hourly) return;
    const hourly = [...value.hourly];
    hourly[hour] = cell;
    onChange({ ...value, hourly });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FieldLabel>How busy it gets</FieldLabel>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gt-text)' }}>
          <input
            type="radio"
            name="gym-crowd-mode"
            checked={value === null}
            onChange={() => onChange(null)}
            disabled={disabled}
          />
          No crowd data
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gt-text)' }}>
          <input
            type="radio"
            name="gym-crowd-mode"
            checked={value !== null}
            onChange={() => onChange(EMPTY_CROWD)}
            disabled={disabled}
          />
          Add busy-times info
        </label>
      </div>

      {value === null ? (
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          Members see nothing about crowds for this gym. Leave it here unless the gym gave us
          real numbers.
        </span>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '10px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid var(--gt-border)',
          }}
        >
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <FieldLabel>Right now it feels</FieldLabel>
              <select
                className="gt-input"
                value={value.level}
                onChange={(e) => update({ level: e.target.value as GymCrowdLevel })}
                disabled={disabled}
              >
                {GYM_CROWD_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {CROWD_LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label="How full (0–100)"
              type="number"
              min={0}
              max={100}
              value={value.percentage}
              onChange={(e) => update({ percentage: e.target.value })}
              disabled={disabled}
              style={{ flex: 1 }}
            />
            <TextField
              label="Busiest times (optional)"
              value={value.peakHoursText}
              onChange={(e) => update({ peakHoursText: e.target.value })}
              disabled={disabled}
              placeholder="e.g. 6–8pm on weekdays"
              style={{ flex: 2 }}
            />
          </div>

          {value.hourly === null ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => update({ hourly: Array.from({ length: HOURS_IN_DAY }, () => '') })}
            >
              + Add hour-by-hour chart
            </Button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                All 24 hours are needed. The app draws the whole day or nothing. Each box is how
                full the gym is (0 to 100) at that hour.
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))',
                  gap: 6,
                }}
              >
                {value.hourly.map((cell, hour) => (
                  <label key={hour} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>{hourLabel(hour)}</span>
                    <input
                      className="gt-input"
                      type="number"
                      min={0}
                      max={100}
                      aria-label={`How full at ${hourLabel(hour)}`}
                      value={cell}
                      onChange={(e) => setHour(hour, e.target.value)}
                      disabled={disabled}
                    />
                  </label>
                ))}
              </div>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => update({ hourly: null })}>
                Remove chart
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Passes ───────────────────────────────────────────────────────────────

function PassesEditor({
  value,
  onChange,
  disabled,
}: {
  value: PassDraft[];
  onChange: (v: PassDraft[]) => void;
  disabled: boolean;
}) {
  function update(i: number, patch: Partial<PassDraft>) {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    const next = [...value];
    next.splice(i, 1);
    onChange(next);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FieldLabel>Passes & memberships</FieldLabel>
      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
        Prices the gym gave us, in rupees or dollars (not paisa/cents). Rows left without a name
        are dropped when you save.
      </span>
      {value.map((pass, i) => (
        <div
          key={pass.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid var(--gt-border)',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="gt-input"
              placeholder="Day pass"
              aria-label="Pass name"
              value={pass.title}
              onChange={(e) => update(i, { title: e.target.value })}
              disabled={disabled}
              style={{ flex: 2 }}
            />
            <select
              className="gt-input"
              aria-label="How long it lasts"
              value={pass.type}
              onChange={(e) => update(i, { type: e.target.value as GymPassType })}
              disabled={disabled}
              style={{ flex: 1 }}
            >
              {GYM_PASS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PASS_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <input
              className="gt-input"
              type="number"
              min={0}
              step="0.01"
              placeholder="Price"
              aria-label="Price"
              value={pass.price}
              onChange={(e) => update(i, { price: e.target.value })}
              disabled={disabled}
              style={{ width: 110 }}
            />
            <select
              className="gt-input"
              aria-label="Currency"
              value={pass.currency}
              onChange={(e) => update(i, { currency: e.target.value as GymPassOption['currency'] })}
              disabled={disabled}
              style={{ width: 96 }}
            >
              <option value="NPR">NPR</option>
              <option value="USD">USD</option>
            </select>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => remove(i)}>
              Remove
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              className="gt-input"
              placeholder="What's included (optional), separate with commas"
              aria-label="What's included (optional)"
              value={pass.features}
              onChange={(e) => update(i, { features: e.target.value })}
              disabled={disabled}
              style={{ flex: 1 }}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--gt-text-dim)',
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                checked={pass.isPopular}
                onChange={(e) => update(i, { isPopular: e.target.checked })}
                disabled={disabled}
              />
              Most popular
            </label>
          </div>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              type: 'day_pass',
              title: '',
              price: '',
              currency: 'NPR',
              features: '',
              isPopular: false,
            },
          ])
        }
      >
        + Add pass
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
        setLocalError('Image upload failed. Try again.');
        return;
      }

      const attachRes = await fetch(`/api/admin/gyms/${encodeURIComponent(gymId)}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ uid: reservation.uid, deliveryUrl: reservation.deliveryUrl }),
      });
      if (!attachRes.ok) {
        setLocalError('Uploaded, but could not attach the photo. Try again.');
        return;
      }
      const attached = (await attachRes.json()) as { photo?: GymPhotoRow };
      if (attached.photo) {
        setOrder((o) => [...o, attached.photo as GymPhotoRow]);
      }
      router.refresh();
    } catch {
      setLocalError('Could not reach us just now, so nothing uploaded. Try again.');
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
      setLocalError('Could not reach us just now. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FieldLabel>Photos</FieldLabel>

      {/* The editor is about pictures, so it shows pictures. It used to be a
          list of 56px thumbnails each labelled with its own delivery URL — the
          one thing nobody needed — with no way to tell which of them members
          would actually see first. */}
      {order.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px dashed var(--gt-border-strong)',
            background: 'var(--gt-surface-sunken)',
            color: 'var(--gt-text-dim)',
            fontSize: 13,
          }}
        >
          No photos yet. The first one you add becomes the cover members see.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          {order.map((p, i) => (
            <figure
              key={p.id}
              style={{
                margin: 0,
                borderRadius: 'var(--gt-radius-sm)',
                border: '1px solid var(--gt-border)',
                background: 'var(--gt-surface-sunken)',
                overflow: 'hidden',
                opacity: busyId === p.id ? 0.5 : 1,
              }}
            >
              <div style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.deliveryUrl}
                  alt={`Photo ${i + 1}`}
                  style={{
                    display: 'block',
                    width: '100%',
                    aspectRatio: '4 / 3',
                    objectFit: 'cover',
                    background: 'var(--gt-surface-hover)',
                  }}
                />
                {i === 0 ? (
                  <span style={{ position: 'absolute', top: 8, left: 8 }}>
                    <Badge tone="info">Cover</Badge>
                  </span>
                ) : null}
              </div>
              <figcaption
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: 6,
                  borderTop: '1px solid var(--gt-border)',
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === 0}
                  aria-label={`Move photo ${i + 1} earlier`}
                  onClick={() => move(i, -1)}
                >
                  ←
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === order.length - 1}
                  aria-label={`Move photo ${i + 1} later`}
                  onClick={() => move(i, 1)}
                >
                  →
                </Button>
                <span style={{ marginLeft: 'auto' }}>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete?"
                    size="sm"
                    busy={busyId === p.id}
                    onConfirm={() => void remove(p.id)}
                  />
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Add a photo'}
        </Button>
        <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
          {order.length === 0
            ? 'Nothing uploaded yet.'
            : `${order.length} photo${order.length === 1 ? '' : 's'}. The first one is the cover.`}
        </span>
      </div>
      {localError ? (
        <div role="alert" style={{ color: 'var(--gt-danger)', fontSize: 13 }}>
          {localError}
        </div>
      ) : null}
    </div>
  );
}
