'use client';

import { useMemo, useState } from 'react';
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selected, setSelected] = useState<PartnerRow | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
      setCreateError('Network error.');
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
      setSaving(false);
      setSelected(null);
      setEditForm(null);
      router.refresh();
    } catch {
      setEditError('Network error.');
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
      setEditError('Network error.');
      setSaving(false);
    }
  }

  const columns: Column<PartnerRow>[] = [
    {
      key: 'partner',
      header: 'Partner',
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
              maxWidth: 260,
            }}
          >
            {r.email}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => <StatusChip status={r.isActive ? 'active' : 'suspended'} label={r.isActive ? 'Active' : 'Deactivated'} />,
    },
    {
      key: 'currency',
      header: 'Currency',
      width: 90,
      render: (r) => r.currency,
    },
    {
      key: 'cod',
      header: 'COD',
      width: 70,
      align: 'center',
      render: (r) => (r.acceptsCod ? '✓' : <span style={{ color: 'var(--gt-text-dim)' }}>—</span>),
    },
    {
      key: 'menu',
      header: 'Menu items',
      width: 100,
      align: 'right',
      render: (r) => <span className="gt-numeric">{r.menuCount}</span>,
    },
    {
      key: 'orders',
      header: 'Active orders',
      width: 120,
      align: 'right',
      render: (r) => <span className="gt-numeric">{r.activeOrders}</span>,
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
          <SearchField
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        right={
          <>
            <select
              className="gt-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </select>
            <Button variant="primary" onClick={openCreate}>
              New partner
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={openRow}
        empty="No meal partners yet."
      />

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
            Creates a new web-only login for this restaurant AND its partner row together — this is
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
        title={selected ? selected.name : 'Partner'}
        width={460}
      >
        {selected && editForm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <StatusChip status={selected.isActive ? 'active' : 'suspended'} label={selected.isActive ? 'Active' : 'Deactivated'} />
              <Badge tone="info">{selected.email}</Badge>
            </div>

            <TextField
              label="Restaurant name"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => (f ? { ...f, name: e.target.value } : f))}
              disabled={saving}
            />
            <TextField
              label="Contact person"
              value={editForm.contact}
              onChange={(e) => setEditForm((f) => (f ? { ...f, contact: e.target.value } : f))}
              disabled={saving}
            />
            <TextField
              label="Phone"
              value={editForm.phone}
              onChange={(e) => setEditForm((f) => (f ? { ...f, phone: e.target.value } : f))}
              disabled={saving}
            />
            <TextField
              label="Address"
              value={editForm.addressText}
              onChange={(e) => setEditForm((f) => (f ? { ...f, addressText: e.target.value } : f))}
              disabled={saving}
            />
            <TextField
              label="Service areas (comma-separated)"
              value={editForm.serviceAreas}
              onChange={(e) => setEditForm((f) => (f ? { ...f, serviceAreas: e.target.value } : f))}
              disabled={saving}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <FieldLabel>Delivery service area (center + radius)</FieldLabel>
              <LocationPicker
                mode="radius"
                value={editForm.serviceArea}
                onChange={(v) => setEditForm((f) => (f ? { ...f, serviceArea: v } : f))}
                disabled={saving}
                height={280}
                ariaLabel="Partner service area"
              />
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <FieldLabel>Currency</FieldLabel>
              <select
                className="gt-input"
                value={editForm.currency}
                onChange={(e) =>
                  setEditForm((f) => (f ? { ...f, currency: e.target.value as 'NPR' | 'USD' } : f))
                }
                disabled={saving || currencyLocked}
              >
                <option value="NPR">NPR</option>
                <option value="USD">USD</option>
              </select>
              <span style={{ fontSize: 12, color: currencyLocked ? 'var(--gt-warning)' : 'var(--gt-text-faint)' }}>
                {currencyLocked && selected
                  ? `Locked after operational history: ${historySummary(selected.safeguards.currencyHistory)}.`
                  : 'Currency can change only before the first menu or financial record is created.'}
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--gt-text)' }}>
              <input
                type="checkbox"
                checked={editForm.acceptsCod}
                onChange={(e) => setEditForm((f) => (f ? { ...f, acceptsCod: e.target.checked } : f))}
                disabled={saving}
              />
              Accepts cash on delivery
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="primary" disabled={saving} onClick={() => void saveEdit()}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>

            <PartnerRevenuePanel partnerId={selected.id} />

            <div style={{ paddingTop: 16, borderTop: '1px solid var(--gt-border)' }}>
              {selected.isActive ? (
                <>
                  {liveOrderImpact && liveOrderImpact.total > 0 ? (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        background: 'color-mix(in srgb, var(--gt-danger) 8%, var(--gt-surface))',
                        border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
                        color: 'var(--gt-danger)',
                        fontSize: 13,
                      }}
                    >
                      <strong>Deactivation blocked</strong>
                      <div style={{ marginTop: 4, marginBottom: 10 }}>
                        {liveOrderImpact.total} live order{liveOrderImpact.total === 1 ? '' : 's'} remain
                        ({liveOrderSummary(liveOrderImpact)}). Finish or cancel them before disabling this
                        restaurant.
                      </div>
                      <Button size="sm" onClick={() => router.push('/admin/orders')}>
                        Open order oversight
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginBottom: 8 }}>
                        Deactivating ends every live session for this login immediately — the partner is
                        logged out everywhere and can no longer sign in.
                      </div>
                      <ConfirmButton
                        label="Deactivate partner"
                        confirmLabel="Confirm deactivate?"
                        busyLabel="Deactivating…"
                        busy={saving}
                        onConfirm={() => void toggleActive(false)}
                      />
                    </>
                  )}
                </>
              ) : (
                <Button variant="primary" disabled={saving} onClick={() => void toggleActive(true)}>
                  {saving ? 'Reactivating…' : 'Reactivate partner'}
                </Button>
              )}
            </div>

            {editError ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{editError}</div> : null}
          </div>
        ) : null}
      </Drawer>
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
