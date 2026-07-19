'use client';

import { formatMoney } from '@gym/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  type Column,
  ConfirmButton,
  DataTable,
  Drawer,
  EmptyState,
  SearchField,
  StatTile,
  StatusChip,
} from '@/components/console';

type SubStatus = 'active' | 'paused' | 'cancelled';
type CycleStatus = 'open' | 'awaiting_payment' | 'paid' | 'void';

interface CurrentCycle {
  weekStart: string;
  weekEnd: string;
  amountMinor: number;
  status: CycleStatus;
}

interface SubscriptionRow {
  id: string;
  account: { id: string; email: string; displayName: string };
  partner: { id: string; name: string };
  daysOfWeek: number[];
  window: 'lunch' | 'dinner';
  planType: 'fixed_meal' | 'partner_rotating';
  mealName: string | null;
  pricePerDayMinor: number;
  currency: string;
  paymentMethod: 'esewa' | 'khalti' | 'cod';
  startDate: string;
  status: SubStatus;
  createdAt: string;
  currentCycle: CurrentCycle | null;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TABS: readonly { key: 'all' | SubStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const STATUS_CHIP: Record<SubStatus, { status: 'active' | 'suspended' | 'ended'; label: string }> = {
  active: { status: 'active', label: 'Active' },
  paused: { status: 'suspended', label: 'Paused' },
  cancelled: { status: 'ended', label: 'Cancelled' },
};

const CYCLE_LABEL: Record<CycleStatus, string> = {
  open: 'Open',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  void: 'Void',
};

const PAYMENT_LABEL: Record<SubscriptionRow['paymentMethod'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  cod: 'Cash on delivery',
};

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function scheduleLabel(days: number[], window: SubscriptionRow['window']): string {
  const sorted = [...days].sort((a, b) => a - b);
  const dayStr = sorted.length ? sorted.map((d) => DAY_LABELS[d] ?? '?').join(' ') : '—';
  return `${dayStr} · ${window === 'lunch' ? 'Lunch' : 'Dinner'}`;
}

function planLabel(row: SubscriptionRow): string {
  if (row.planType === 'fixed_meal') return row.mealName ?? 'Fixed meal';
  return `${row.partner.name} rotating menu`;
}

/**
 * Admin meal-subscription roster (WP-11 / P0-11 admin half) — the surface
 * that never existed: before this, ops could not see an individual member's
 * recurring meal plan, its schedule, or this week's billing-cycle state, let
 * alone pause or cancel it. Loads once from the NEW `GET
 * /api/admin/meal-subscriptions`; tab/search filter client-side over the
 * loaded roster (capped at 500, newest first — matches the console's other
 * roster screens). Pause/Resume/Cancel POST to the same NEW admin-authed
 * route (never the member-authed `/api/meals/subscriptions/[id]`), then
 * reload the roster.
 */
export function MealSubscriptionsRoster() {
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('active');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/meal-subscriptions', { credentials: 'include' });
      if (!res.ok) {
        setError(res.status === 403 ? 'You are not allowed to view meal subscriptions.' : 'Could not load the roster.');
        setRows([]);
        return;
      }
      const data = (await res.json()) as { subscriptions: SubscriptionRow[] };
      setRows(data.subscriptions);
    } catch {
      setError('Network error.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(() => {
    const c = { active: 0, paused: 0, cancelled: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && r.status !== tab) return false;
      if (!q) return true;
      return (
        r.account.email.toLowerCase().includes(q) ||
        r.account.displayName.toLowerCase().includes(q) ||
        r.partner.name.toLowerCase().includes(q)
      );
    });
  }, [rows, tab, query]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function openRow(row: SubscriptionRow) {
    setSelectedId(row.id);
    setActionError(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
  }

  async function act(action: 'pause' | 'resume' | 'cancel') {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/admin/meal-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: selected.id, action }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const code =
          typeof payload === 'object' &&
          payload !== null &&
          'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : null;
        if (code === 'payment_review_required' || code === 'refund_required') {
          setActionError(
            code === 'payment_review_required'
              ? 'A receipt is under review. Reject it in Meal Payments before changing this plan.'
              : 'This plan has a paid delivery or cycle. Refund it in Meal Payments so payment and fulfilment are reversed together.',
          );
          setBusy(false);
          return;
        }
        setActionError(
          res.status === 409
            ? 'This plan already changed state — refreshing…'
            : res.status === 403
              ? 'You are not allowed to manage meal subscriptions.'
              : 'Could not save that change. Try again.',
        );
        if (res.status === 409) {
          setBusy(false);
          setSelectedId(null);
          await load();
          return;
        }
        setBusy(false);
        return;
      }
      setBusy(false);
      setSelectedId(null);
      await load();
    } catch {
      setActionError('Network error.');
      setBusy(false);
    }
  }

  const columns: Column<SubscriptionRow>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.account.displayName || r.account.email}
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
            {r.account.email}
          </div>
        </div>
      ),
    },
    {
      key: 'partner',
      header: 'Partner',
      render: (r) => <span style={{ fontSize: 13 }}>{r.partner.name}</span>,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      render: (r) => <span style={{ fontSize: 13 }}>{scheduleLabel(r.daysOfWeek, r.window)}</span>,
    },
    {
      key: 'price',
      header: 'Price/day',
      width: 110,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {formatMoney(r.pricePerDayMinor, r.currency)}
        </span>
      ),
    },
    {
      key: 'cycle',
      header: 'This week',
      width: 150,
      render: (r) =>
        r.currentCycle ? (
          <span style={{ fontSize: 13 }}>{CYCLE_LABEL[r.currentCycle.status]}</span>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => (
        <StatusChip status={STATUS_CHIP[r.status].status} label={STATUS_CHIP[r.status].label} />
      ),
    },
    {
      key: 'started',
      header: 'Started',
      width: 120,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {DATE_FMT.format(new Date(r.startDate))}
        </span>
      ),
    },
  ];

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Active" value={counts.active} />
        <StatTile label="Paused" value={counts.paused} />
        <StatTile label="Cancelled" value={counts.cancelled} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 13,
                  fontWeight: 600,
                  background: active ? 'var(--gt-red)' : 'transparent',
                  color: active ? 'var(--gt-accent-ink)' : 'var(--gt-text)',
                  border: active ? '1px solid var(--gt-red)' : '1px solid var(--gt-border)',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
          <SearchField
            placeholder="Search member or partner…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>
      ) : null}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--gt-text-dim)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No meal subscriptions yet"
          description="Recurring meal plans members set up in the app appear here."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={openRow}
          empty="No subscriptions in this view."
        />
      )}

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? selected.account.displayName || selected.account.email : 'Subscription'}
        width={460}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{selected.account.email}</div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusChip
                status={STATUS_CHIP[selected.status].status}
                label={STATUS_CHIP[selected.status].label}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
              <Row label="Partner">{selected.partner.name}</Row>
              <Row label="Plan">{planLabel(selected)}</Row>
              <Row label="Schedule">{scheduleLabel(selected.daysOfWeek, selected.window)}</Row>
              <Row label="Price/day">{formatMoney(selected.pricePerDayMinor, selected.currency)}</Row>
              <Row label="Payment method">{PAYMENT_LABEL[selected.paymentMethod]}</Row>
              <Row label="Started">{DATE_FMT.format(new Date(selected.startDate))}</Row>
            </div>

            {selected.currentCycle ? (
              <div
                style={{
                  border: '1px solid var(--gt-border)',
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: 'var(--gt-text-dim)',
                    fontFamily: 'var(--font-heading)',
                  }}
                >
                  This week&apos;s billing cycle
                </div>
                <div>
                  {selected.currentCycle.weekStart} – {selected.currentCycle.weekEnd}
                </div>
                <div>
                  {CYCLE_LABEL[selected.currentCycle.status]} ·{' '}
                  {formatMoney(selected.currentCycle.amountMinor, selected.currency)}
                </div>
              </div>
            ) : null}

            {actionError ? (
              <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{actionError}</div>
            ) : null}

            {selected.status !== 'cancelled' ? (
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                {selected.status === 'active' ? (
                  <ConfirmButton label="Pause plan" onConfirm={() => void act('pause')} busy={busy} />
                ) : (
                  <ConfirmButton label="Resume plan" onConfirm={() => void act('resume')} busy={busy} />
                )}
                <ConfirmButton
                  label="Cancel plan"
                  confirmLabel="Confirm cancel"
                  onConfirm={() => void act('cancel')}
                  busy={busy}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}
