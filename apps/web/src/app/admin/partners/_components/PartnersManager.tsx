'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  Badge,
  Button,
  type Column,
  ConfirmButton,
  DataTable,
  Drawer,
  Modal,
  SearchField,
  StatusChip,
  TextField,
  Toolbar,
} from '@/components/console';
import type { LocationValue } from '@/components/console/LocationPicker';
import {
  hasPartnerCurrencyHistory,
  type PartnerCurrencyHistory,
  type PartnerLiveOrderImpact,
} from '@/lib/partnerAdminSafeguards';
import { KeyboardRows } from '../../_components/KeyboardRows';
import { QueueTabs } from '../../_components/QueueTabs';
import { PartnerMenuPanel } from './PartnerMenuPanel';
import { PartnerRevenuePanel } from './PartnerRevenuePanel';
import type { PartnerRow } from './types';

// Client-only: Leaflet touches `window` at import, so never SSR this.
const LocationPicker = dynamic(
  () => import('@/components/console/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 300,
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

/** Compose a picker value from a partner row's stored geometry (or null). */
function rowToServiceArea(row: PartnerRow): LocationValue | null {
  if (row.serviceLat == null || row.serviceLng == null) return null;
  return {
    lat: row.serviceLat,
    lng: row.serviceLng,
    radiusKm: row.serviceRadiusKm ?? undefined,
  };
}

/** Flatten a picker value to the three nullable columns the API expects. */
function serviceAreaPayload(v: LocationValue | null): {
  serviceLat: number | null;
  serviceLng: number | null;
  serviceRadiusKm: number | null;
} {
  if (!v) return { serviceLat: null, serviceLng: null, serviceRadiusKm: null };
  return {
    serviceLat: v.lat,
    serviceLng: v.lng,
    serviceRadiusKm: v.radiusKm ?? null,
  };
}

/**
 * Meal-partner roster (plan §2/§7 P6). Toolbar+DataTable+detail Drawer
 * (roster-page template): a search/status filter above the table, a "New
 * partner" modal that mints the login + restaurant row together, and a Drawer
 * per row for editing fields or deactivating (which also ends every live
 * session for that partner's login — the second kill-switch alongside
 * `requirePartner`'s live isActive check).
 */

async function parseErrorCode(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

interface PartnerMutationError {
  code: string | null;
  history?: PartnerCurrencyHistory;
  liveOrders?: PartnerLiveOrderImpact;
}

const currencyHistorySchema = z.object({
  menuItems: z.number().int().nonnegative(),
  subscriptions: z.number().int().nonnegative(),
  billingCycles: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  paymentRequests: z.number().int().nonnegative(),
});

const liveOrderImpactSchema = z.object({
  total: z.number().int().nonnegative(),
  byStatus: z.object({
    pending: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    preparing: z.number().int().nonnegative(),
    out_for_delivery: z.number().int().nonnegative(),
  }),
});

const partnerMutationErrorSchema = z.object({
  error: z.string().optional(),
  history: currencyHistorySchema.optional(),
  liveOrders: liveOrderImpactSchema.optional(),
});

async function parseMutationError(res: Response): Promise<PartnerMutationError> {
  try {
    const parsed = partnerMutationErrorSchema.safeParse(await res.json());
    if (!parsed.success) return { code: null };
    const data = parsed.data;
    return {
      code: data.error ?? null,
      history: data.history,
      liveOrders: data.liveOrders,
    };
  } catch {
    return { code: null };
  }
}

function historySummary(history: PartnerCurrencyHistory): string {
  const labels: [keyof PartnerCurrencyHistory, string][] = [
    ['menuItems', 'menu item'],
    ['subscriptions', 'subscription'],
    ['billingCycles', 'billing cycle'],
    ['orders', 'order'],
    ['paymentRequests', 'payment request'],
  ];
  return labels
    .filter(([key]) => history[key] > 0)
    .map(([key, label]) => `${history[key]} ${label}${history[key] === 1 ? '' : 's'}`)
    .join(', ');
}

function liveOrderSummary(impact: PartnerLiveOrderImpact): string {
  const labels: [keyof PartnerLiveOrderImpact['byStatus'], string][] = [
    ['pending', 'pending'],
    ['confirmed', 'confirmed'],
    ['preparing', 'preparing'],
    ['out_for_delivery', 'out for delivery'],
  ];
  return labels
    .filter(([status]) => impact.byStatus[status] > 0)
    .map(([status, label]) => `${impact.byStatus[status]} ${label}`)
    .join(', ');
}

function friendlyError(status: number, code: string | null): string {
  switch (code) {
    case 'email_taken':
      return 'An account already exists with that email.';
    case 'create_failed':
      return 'Could not create that partner. Try again.';
    case 'not_found':
      return 'That partner no longer exists.';
    case 'empty':
      return 'Nothing to save.';
    default:
      break;
  }
  if (status === 403) return 'You are not allowed to manage meal partners.';
  return 'Something went wrong. Try again.';
}

function friendlyMutationError(status: number, error: PartnerMutationError): string {
  if (error.code === 'currency_history_locked' && error.history) {
    return `Currency is locked because this partner already has ${historySummary(error.history)}. Create a new partner account for a different currency.`;
  }
  if (error.code === 'partner_has_live_orders' && error.liveOrders) {
    return `Cannot deactivate while ${error.liveOrders.total} live order${error.liveOrders.total === 1 ? '' : 's'} remain (${liveOrderSummary(error.liveOrders)}). Finish or cancel them first.`;
  }
  if (error.code === 'partner_edit_conflict') {
    return 'This partner changed in another session. Refresh and try again.';
  }
  return friendlyError(status, error.code);
}

function parseServiceAreas(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface CreateFormState {
  email: string;
  password: string;
  name: string;
  contact: string;
  phone: string;
  addressText: string;
  serviceAreas: string;
  serviceArea: LocationValue | null;
  acceptsCod: boolean;
  currency: 'NPR' | 'USD';
}

const EMPTY_CREATE: CreateFormState = {
  email: '',
  password: '',
  name: '',
  contact: '',
  phone: '',
  addressText: '',
  serviceAreas: '',
  serviceArea: null,
  acceptsCod: true,
  currency: 'NPR',
};

interface EditFormState {
  name: string;
  contact: string;
  phone: string;
  addressText: string;
  serviceAreas: string;
  serviceArea: LocationValue | null;
  acceptsCod: boolean;
  currency: 'NPR' | 'USD';
}

type StatusFilter = 'all' | 'active' | 'inactive';

const STATUS_TABS: readonly { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Switched off' },
];

function rowToEditForm(row: PartnerRow): EditFormState {
  return {
    name: row.name,
    contact: row.contact,
    phone: row.phone,
    addressText: row.addressText,
    serviceAreas: row.serviceAreas.join(', '),
    serviceArea: rowToServiceArea(row),
    acceptsCod: row.acceptsCod,
    // The column has no DB enum; every write path (create/edit APIs) restricts
    // it to 'NPR'|'USD', so this cast reflects that real invariant.
    currency: row.currency === 'USD' ? 'USD' : 'NPR',
  };
}

export function PartnersManager({ partners }: { partners: PartnerRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selected, setSelected] = useState<PartnerRow | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // A save that closed the drawer told the operator nothing about whether it
  // worked. It now stays open and says so, and the button knows whether there
  // is anything left to save.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by a successful save, consumed when the refreshed rows land.
  const reseedAfterSave = useRef(false);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  // Keep an open drawer pointed at the freshest copy of its row. `router
  // .refresh()` re-runs the server load after every mutation; without this the
  // panel would keep comparing its fields against the row as it was when it
  // opened, and a just-saved form would look permanently unsaved.
  const openId = selected?.id ?? null;
  useEffect(() => {
    if (!openId) return;
    const fresh = partners.find((p) => p.id === openId);
    if (!fresh) return;
    setSelected(fresh);
    if (reseedAfterSave.current) {
      reseedAfterSave.current = false;
      setEditForm(rowToEditForm(fresh));
    }
  }, [partners, openId]);

  /** Has this drawer's form moved away from the row it was opened on? */
  const editDirty = useMemo(() => {
    if (!selected || !editForm) return false;
    const base = rowToEditForm(selected);
    return (
      base.name !== editForm.name ||
      base.contact !== editForm.contact ||
      base.phone !== editForm.phone ||
      base.addressText !== editForm.addressText ||
      base.serviceAreas !== editForm.serviceAreas ||
      base.acceptsCod !== editForm.acceptsCod ||
      base.currency !== editForm.currency ||
      JSON.stringify(base.serviceArea) !== JSON.stringify(editForm.serviceArea)
    );
  }, [selected, editForm]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return partners.filter((p) => {
      if (statusFilter === 'active' && !p.isActive) return false;
      if (statusFilter === 'inactive' && p.isActive) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
    });
  }, [partners, query, statusFilter]);

  function openCreate() {
    setCreateForm(EMPTY_CREATE);
    setCreateError(null);
    setCreateOpen(true);
  }

  function openRow(row: PartnerRow) {
    setSelected(row);
    setEditForm(rowToEditForm(row));
    setEditError(null);
    setSavedAt(null);
  }

  /** Every field change invalidates the last outcome shown next to Save. */
  function editField(next: (f: EditFormState) => EditFormState) {
    setSavedAt(null);
    setEditError(null);
    setEditForm((f) => (f ? next(f) : f));
  }

  function closeDrawer() {
    if (saving) return;
    setSelected(null);
    setEditForm(null);
  }

  async function createPartner() {
    if (!createForm.email.trim() || !createForm.password || !createForm.name.trim()) {
      setCreateError('Email, password, and name are required.');
      return;
    }
    if (createForm.password.length < 8) {
      setCreateError('Password must be at least 8 characters.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: createForm.email.trim(),
          password: createForm.password,
          name: createForm.name.trim(),
          contact: createForm.contact.trim(),
          phone: createForm.phone.trim(),
          addressText: createForm.addressText.trim(),
          serviceAreas: parseServiceAreas(createForm.serviceAreas),
          ...serviceAreaPayload(createForm.serviceArea),
          acceptsCod: createForm.acceptsCod,
          currency: createForm.currency,
        }),
      });
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setCreateError(friendlyError(res.status, code));
        setCreating(false);
        return;
      }
      setCreating(false);
      setCreateOpen(false);
      router.refresh();
    } catch {
      setCreateError('Could not reach us just now. Try again.');
      setCreating(false);
    }
  }

  async function saveEdit() {
    if (!selected || !editForm) return;
    if (!editForm.name.trim()) {
      setEditError('Name is required.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/partners/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editForm.name.trim(),
          contact: editForm.contact.trim(),
          phone: editForm.phone.trim(),
          addressText: editForm.addressText.trim(),
          serviceAreas: parseServiceAreas(editForm.serviceAreas),
          ...serviceAreaPayload(editForm.serviceArea),
          acceptsCod: editForm.acceptsCod,
          currency: editForm.currency,
        }),
      });
      if (!res.ok) {
        const error = await parseMutationError(res);
        if (error.code === 'currency_history_locked' && error.history) {
          const history = error.history;
          setSelected((row) =>
            row
              ? {
                  ...row,
                  safeguards: { ...row.safeguards, currencyHistory: history },
                }
              : row,
          );
          setEditForm((form) =>
            form && selected ? { ...form, currency: selected.currency === 'USD' ? 'USD' : 'NPR' } : form,
          );
        }
        setEditError(friendlyMutationError(res.status, error));
        setSaving(false);
        return;
      }
      // The drawer stays open on a successful save. Closing it was the only
      // signal anything had happened, which meant an operator fixing three
      // fields on one restaurant had to find the row again after each one.
      setSaving(false);
      setSavedAt(Date.now());
      reseedAfterSave.current = true;
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedAt(null), 6000);
      router.refresh();
    } catch {
      setEditError('Could not reach us just now. Nothing was saved, and your edits are still here.');
      setSaving(false);
    }
  }

  async function toggleActive(next: boolean) {
    if (!selected) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/partners/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        const error = await parseMutationError(res);
        if (error.code === 'partner_has_live_orders' && error.liveOrders) {
          const liveOrders = error.liveOrders;
          setSelected((row) =>
            row
              ? {
                  ...row,
                  activeOrders: liveOrders.total,
                  safeguards: { ...row.safeguards, liveOrders },
                }
              : row,
          );
        }
        setEditError(friendlyMutationError(res.status, error));
        setSaving(false);
        return;
      }
      setSaving(false);
      setSelected(null);
      setEditForm(null);
      router.refresh();
    } catch {
      setEditError('Could not reach us just now. Try again.');
      setSaving(false);
    }
  }

  const columns: Column<PartnerRow>[] = [
    // The list should preview what matters about a restaurant: who it is, and
    // where it delivers. The address was in the row data all along and shown
    // nowhere, so two branches of the same chain looked identical.
    {
      key: 'partner',
      header: 'Restaurant',
      render: (r) => (
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
              maxWidth: 320,
            }}
          >
            {r.email}
          </div>
        </div>
      ),
    },
    {
      key: 'area',
      header: 'Delivers to',
      render: (r) =>
        r.serviceAreas.length > 0 ? (
          <span
            style={{
              fontSize: 13,
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 260,
            }}
            title={r.serviceAreas.join(', ')}
          >
            {r.serviceAreas.join(', ')}
          </span>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--gt-text-faint)' }}>No areas set</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (r) => (
        <StatusChip
          status={r.isActive ? 'active' : 'suspended'}
          label={r.isActive ? 'Active' : 'Switched off'}
        />
      ),
    },
    {
      key: 'payments',
      header: 'Payments',
      width: 150,
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone="neutral">{r.currency}</Badge>
          {r.acceptsCod ? <Badge tone="neutral">Cash</Badge> : null}
        </div>
      ),
    },
    {
      key: 'menu',
      header: 'Menu items',
      width: 110,
      align: 'right',
      render: (r) =>
        r.menuCount === 0 ? (
          <span style={{ color: 'var(--gt-text-faint)' }}>Empty</span>
        ) : (
          <span className="gt-numeric">{r.menuCount}</span>
        ),
    },
    // A live order count is the one number here that means someone is waiting,
    // so zero stays quiet and anything above it does not.
    {
      key: 'orders',
      header: 'Live orders',
      width: 110,
      align: 'right',
      render: (r) =>
        r.activeOrders === 0 ? (
          <span style={{ color: 'var(--gt-text-faint)' }}>None</span>
        ) : (
          <span className="gt-numeric" style={{ fontWeight: 600 }}>
            {r.activeOrders}
          </span>
        ),
    },
  ];

  const currencyLocked = selected
    ? hasPartnerCurrencyHistory(selected.safeguards.currencyHistory)
    : false;
  const liveOrderImpact = selected?.safeguards.liveOrders ?? null;

  return (
    <>
      <Toolbar
        left={
          <QueueTabs
            label="Which restaurants to show"
            tabs={STATUS_TABS}
            value={statusFilter}
            onChange={setStatusFilter}
            /* Neutral: this page's one accent belongs to New partner. */
            tone="neutral"
          />
        }
        right={
          <>
            <div style={{ width: 240, maxWidth: '100%' }}>
              <SearchField
                placeholder="Name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search restaurants"
              />
            </div>
            <Button variant="primary" onClick={openCreate}>
              New partner
            </Button>
          </>
        }
      />

      <KeyboardRows>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={openRow}
          rowAriaLabel={(r) => `Edit ${r.name}`}
          empty={
            query.trim() || statusFilter !== 'all' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <span>No restaurant matches this view.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setStatusFilter('all');
                  }}
                >
                  Show all restaurants
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <span>No restaurants yet.</span>
                <Button variant="ghost" size="sm" onClick={openCreate}>
                  Add the first one
                </Button>
              </div>
            )
          }
        />
      </KeyboardRows>

      <Modal
        open={createOpen}
        onClose={() => (creating ? undefined : setCreateOpen(false))}
        title="New meal partner"
        width={560}
        footer={
          <>
            <Button variant="ghost" disabled={creating} onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={creating} onClick={() => void createPartner()}>
              {creating ? 'Creating…' : 'Create partner'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Creates a new web-only login for this restaurant AND its partner row together. This is
            the only way a partner account is ever minted.
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Restaurant name"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              disabled={creating}
              style={{ flex: 1 }}
            />
            <TextField
              label="Contact person"
              value={createForm.contact}
              onChange={(e) => setCreateForm((f) => ({ ...f, contact: e.target.value }))}
              disabled={creating}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Login email"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              disabled={creating}
              style={{ flex: 1 }}
            />
            <TextField
              label="Password"
              type="password"
              hint="At least 8 characters."
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              disabled={creating}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Phone"
              value={createForm.phone}
              onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
              disabled={creating}
              style={{ flex: 1 }}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <FieldLabel>Currency</FieldLabel>
              <select
                className="gt-input"
                value={createForm.currency}
                onChange={(e) => setCreateForm((f) => ({ ...f, currency: e.target.value as 'NPR' | 'USD' }))}
                disabled={creating}
              >
                <option value="NPR">NPR</option>
                <option value="USD">USD</option>
              </select>
            </label>
          </div>
          <TextField
            label="Address"
            value={createForm.addressText}
            onChange={(e) => setCreateForm((f) => ({ ...f, addressText: e.target.value }))}
            disabled={creating}
          />
          <TextField
            label="Service areas (comma-separated)"
            hint="Matched against a member's saved-address area at checkout."
            value={createForm.serviceAreas}
            onChange={(e) => setCreateForm((f) => ({ ...f, serviceAreas: e.target.value }))}
            disabled={creating}
            placeholder="Baneshwor, New Baneshwor, Koteshwor"
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <FieldLabel>Delivery service area (center + radius)</FieldLabel>
            <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              Optional map reach: drop the kitchen pin and drag the radius. Used to
              range-check a member&apos;s delivery point, alongside the area names above.
            </div>
            <LocationPicker
              mode="radius"
              value={createForm.serviceArea}
              onChange={(v) => setCreateForm((f) => ({ ...f, serviceArea: v }))}
              disabled={creating}
              height={280}
              ariaLabel="Partner service area"
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--gt-text)' }}>
            <input
              type="checkbox"
              checked={createForm.acceptsCod}
              onChange={(e) => setCreateForm((f) => ({ ...f, acceptsCod: e.target.checked }))}
              disabled={creating}
            />
            Accepts cash on delivery
          </label>
          {createError ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{createError}</div> : null}
        </div>
      </Modal>

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? selected.name : 'Restaurant'}
        width={460}
        /* Pinned, so the save never scrolls away behind the map, the revenue
           panel and the menu panel that sit under it. */
        footer={
          selected && editForm ? (
            <>
              <span
                role="status"
                aria-live="polite"
                style={{ marginRight: 'auto', fontSize: 13, color: 'var(--gt-text-dim)' }}
              >
                {saving
                  ? ''
                  : editDirty
                    ? 'Not saved yet'
                    : savedAt
                      ? 'Saved'
                      : ''}
              </span>
              <Button
                variant="primary"
                disabled={saving || !editDirty}
                onClick={() => void saveEdit()}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          ) : undefined
        }
      >
        {selected && editForm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusChip
                status={selected.isActive ? 'active' : 'suspended'}
                label={selected.isActive ? 'Active' : 'Switched off'}
              />
              <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{selected.email}</span>
            </div>

            {editError ? (
              <div
                role="alert"
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--gt-radius-sm)',
                  border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
                  background: 'var(--gt-danger-weak)',
                  color: 'var(--gt-text)',
                  fontSize: 13,
                }}
              >
                {editError}
              </div>
            ) : null}

            {/* Three named groups instead of one undifferentiated stack of
                eight inputs: who the restaurant is, where it delivers, and how
                it takes money. */}
            <Group title="The restaurant">
              <TextField
                label="Restaurant name"
                value={editForm.name}
                onChange={(e) => editField((f) => ({ ...f, name: e.target.value }))}
                disabled={saving}
              />
              <TextField
                label="Contact person"
                value={editForm.contact}
                onChange={(e) => editField((f) => ({ ...f, contact: e.target.value }))}
                disabled={saving}
              />
              <TextField
                label="Phone"
                value={editForm.phone}
                onChange={(e) => editField((f) => ({ ...f, phone: e.target.value }))}
                disabled={saving}
              />
            </Group>

            <Group title="Where it delivers">
              <TextField
                label="Address"
                value={editForm.addressText}
                onChange={(e) => editField((f) => ({ ...f, addressText: e.target.value }))}
                disabled={saving}
              />
              <TextField
                label="Area names"
                hint="Separate with commas. Matched against a member's saved address at checkout."
                value={editForm.serviceAreas}
                onChange={(e) => editField((f) => ({ ...f, serviceAreas: e.target.value }))}
                disabled={saving}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <FieldLabel>Map reach</FieldLabel>
                <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  Drop the kitchen pin and drag the radius. Used alongside the area names above.
                </div>
                <LocationPicker
                  mode="radius"
                  value={editForm.serviceArea}
                  onChange={(v) => editField((f) => ({ ...f, serviceArea: v }))}
                  disabled={saving}
                  height={280}
                  ariaLabel="Partner service area"
                />
              </div>
            </Group>

            <Group title="How it takes money">
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <FieldLabel>Currency</FieldLabel>
                <select
                  className="gt-input"
                  value={editForm.currency}
                  onChange={(e) =>
                    editField((f) => ({ ...f, currency: e.target.value as 'NPR' | 'USD' }))
                  }
                  disabled={saving || currencyLocked}
                >
                  <option value="NPR">NPR</option>
                  <option value="USD">USD</option>
                </select>
                <span
                  style={{
                    fontSize: 12,
                    color: currencyLocked ? 'var(--gt-warning)' : 'var(--gt-text-faint)',
                  }}
                >
                  {currencyLocked && selected
                    ? `Locked, because this restaurant already has ${historySummary(selected.safeguards.currencyHistory)}.`
                    : 'Can change only until the first menu item or payment exists.'}
                </span>
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 14,
                  color: 'var(--gt-text)',
                  minHeight: 44,
                }}
              >
                <input
                  type="checkbox"
                  checked={editForm.acceptsCod}
                  onChange={(e) => editField((f) => ({ ...f, acceptsCod: e.target.checked }))}
                  disabled={saving}
                  style={{ width: 18, height: 18 }}
                />
                Takes cash on delivery
              </label>
            </Group>

            <PartnerRevenuePanel partnerId={selected.id} />

            <PartnerMenuPanel partnerId={selected.id} />

            {/* Switching a restaurant off is the one irreversible-feeling
                action here, so it sits last, apart, and stays quiet until it
                is wanted. */}
            <Group title="Switch off">
              {selected.isActive ? (
                liveOrderImpact && liveOrderImpact.total > 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 'var(--gt-radius-sm)',
                      background: 'var(--gt-danger-weak)',
                      border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
                      color: 'var(--gt-text)',
                      fontSize: 13,
                    }}
                  >
                    <strong style={{ fontFamily: 'var(--font-heading)' }}>
                      Cannot switch off yet
                    </strong>
                    <div style={{ marginTop: 4, marginBottom: 10 }}>
                      {liveOrderImpact.total} order{liveOrderImpact.total === 1 ? ' is' : 's are'}{' '}
                      still moving ({liveOrderSummary(liveOrderImpact)}). Finish or cancel them
                      first.
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => router.push('/admin/orders')}>
                      Open the order board
                    </Button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                      This signs the restaurant out everywhere straight away, and it can no longer
                      sign back in.
                    </div>
                    <ConfirmButton
                      label="Switch this restaurant off"
                      confirmLabel="Switch it off?"
                      busyLabel="Switching off…"
                      busy={saving}
                      onConfirm={() => void toggleActive(false)}
                    />
                  </>
                )
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                    This restaurant is switched off. Members cannot order from it and it cannot
                    sign in.
                  </div>
                  <Button variant="dark" disabled={saving} onClick={() => void toggleActive(true)}>
                    {saving ? 'Switching on…' : 'Switch it back on'}
                  </Button>
                </>
              )}
            </Group>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

/**
 * A named group of fields inside the editor. Grouping is the whole difference
 * between a form you read and a form you survive: the drawer used to be eight
 * inputs, a map and two panels in one undifferentiated column.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 12,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-faint)',
          paddingBottom: 8,
          borderBottom: '1px solid var(--gt-border)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
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
