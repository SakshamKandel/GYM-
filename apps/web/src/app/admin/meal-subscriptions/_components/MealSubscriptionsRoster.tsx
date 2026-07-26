'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  type Column,
  ConfirmButton,
  DataTable,
  Drawer,
  EmptyState,
  SearchField,
  SkeletonRows,
  StatTile,
  StatusChip,
  Toolbar,
} from '@/components/console';
import { formatDate, formatDateLabel, formatMoney } from '@/lib/format';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { KeyboardRows } from '../../_components/KeyboardRows';
import { MemberLink } from '../../_components/MemberLink';
import { QueueTabs } from '../../_components/QueueTabs';
import { useUrlSearch, useUrlState } from '../../_components/useUrlState';

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

const TAB_KEYS: readonly (typeof TABS)[number]['key'][] = [
  'active',
  'paused',
  'cancelled',
  'all',
];

const STATUS_CHIP: Record<SubStatus, { status: 'active' | 'suspended' | 'ended'; label: string }> = {
  active: { status: 'active', label: 'Active' },
  paused: { status: 'suspended', label: 'Paused' },
  cancelled: { status: 'ended', label: 'Cancelled' },
};

const CYCLE_LABEL: Record<CycleStatus, string> = {
  open: 'Running',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  void: 'Cancelled',
};

/**
 * This week's money state, in the same toned-chip language the rest of the
 * console uses for a status. It used to be plain 13px text in a column of other
 * plain 13px text, so the one cell that says whether a member still owes for
 * this week read exactly like the restaurant's name next to it.
 */
const CYCLE_TONE: Record<CycleStatus, 'neutral' | 'warning' | 'positive'> = {
  open: 'neutral',
  awaiting_payment: 'warning',
  paid: 'positive',
  void: 'neutral',
};

const PAYMENT_LABEL: Record<SubscriptionRow['paymentMethod'], string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  cod: 'Cash on delivery',
};

/** `Mon Wed Fri`, always in week order, never a bare number. */
function dayList(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.length ? sorted.map((d) => DAY_LABELS[d] ?? '?').join(' ') : 'No days set';
}

function scheduleLabel(days: number[], window: SubscriptionRow['window']): string {
  return `${dayList(days)} · ${window === 'lunch' ? 'Lunch' : 'Dinner'}`;
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
export function MealSubscriptionsRoster({
  canViewMembers,
}: {
  /** Viewer holds `members.read`, so member names can link to the record. */
  canViewMembers: boolean;
}) {
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kept in the URL so opening a member record and coming back returns to the
  // same view rather than to Active, unfiltered.
  const [tab, setTab] = useUrlState<(typeof TABS)[number]['key']>('tab', 'active', TAB_KEYS);
  const [query, setQuery] = useUrlSearch('q');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

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
      setError('Could not reach us just now. Try again.');
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
    setConfirmingCancel(false);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
    setConfirmingCancel(false);
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
            ? 'This plan already changed state. Refreshing…'
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
      setActionError('Could not reach us just now. Try again.');
      setBusy(false);
    }
  }

  const columns: Column<SubscriptionRow>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <MemberLink
            id={r.account.id}
            name={r.account.displayName}
            email={r.account.email}
            canView={canViewMembers}
          />
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
      header: 'Restaurant',
      render: (r) => <span style={{ fontSize: 13 }}>{r.partner.name}</span>,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div className="gt-numeric" style={{ fontSize: 13, color: 'var(--gt-text)' }}>
            {dayList(r.daysOfWeek)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {r.window === 'lunch' ? 'Lunch' : 'Dinner'}
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price a day',
      width: 120,
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
      width: 170,
      render: (r) =>
        r.currentCycle ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <Badge tone={CYCLE_TONE[r.currentCycle.status]}>
              {CYCLE_LABEL[r.currentCycle.status]}
            </Badge>
            <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              {formatMoney(r.currentCycle.amountMinor, r.currency)}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--gt-text-faint)' }}>Nothing billed yet</span>
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
          {formatDate(r.startDate)}
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

      <Toolbar
        left={
          <QueueTabs
            label="Which plans to show"
            tabs={TABS.map((t) => ({
              key: t.key,
              label: t.label,
              count: t.key === 'all' ? rows.length : counts[t.key],
            }))}
            value={tab}
            onChange={setTab}
          />
        }
        right={
          <div style={{ width: 280, maxWidth: '100%' }}>
            <SearchField
              placeholder="Member or restaurant"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search meal plans"
            />
          </div>
        }
      />

      {/* A failed load is a state of the page, not a stray red sentence above
          an empty table. It says what went wrong and offers the way out. */}
      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--gt-text)' }}>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}

      {loading ? (
        <SkeletonRows rows={6} cols={columns.length} />
      ) : rows.length === 0 && !error ? (
        <EmptyState
          title="No meal plans yet"
          description="Recurring meal plans members set up in the app appear here."
        />
      ) : (
        <KeyboardRows>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={openRow}
          rowAriaLabel={(r) =>
            `Open ${r.account.displayName || r.account.email}'s plan with ${r.partner.name}`
          }
          empty={
            query.trim() ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <span>No plans match “{query.trim()}”.</span>
                <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              </div>
            ) : (
              'No plans in this view.'
            )
          }
        />
        </KeyboardRows>
      )}

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? selected.account.displayName || selected.account.email : 'Meal plan'}
        width={460}
        /* Pinned, so the two decisions this panel exists for stay reachable
           without scrolling past the plan's details to find them. */
        footer={
          selected && selected.status !== 'cancelled' ? (
            <>
              {selected.status === 'active' ? (
                <ConfirmButton label="Pause plan" onConfirm={() => void act('pause')} busy={busy} />
              ) : (
                <ConfirmButton label="Resume plan" onConfirm={() => void act('resume')} busy={busy} />
              )}
              {/* Ending someone's meal plan takes food off their week, so the
                  confirm names the member and the schedule (FIX 5). */}
              <Button variant="danger" disabled={busy} onClick={() => setConfirmingCancel(true)}>
                {busy ? 'Working…' : 'Cancel plan'}
              </Button>
            </>
          ) : undefined
        }
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
              <Row label="Restaurant">{selected.partner.name}</Row>
              <Row label="Plan">{planLabel(selected)}</Row>
              <Row label="Schedule">{scheduleLabel(selected.daysOfWeek, selected.window)}</Row>
              <Row label="Price a day">
                <span className="gt-numeric">
                  {formatMoney(selected.pricePerDayMinor, selected.currency)}
                </span>
              </Row>
              <Row label="Payment method">{PAYMENT_LABEL[selected.paymentMethod]}</Row>
              <Row label="Started">{formatDate(selected.startDate)}</Row>
            </div>

            {selected.currentCycle ? (
              <div
                style={{
                  border: '1px solid var(--gt-border)',
                  borderRadius: 'var(--gt-radius-sm)',
                  background: 'var(--gt-surface-sunken)',
                  padding: 12,
                  fontSize: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
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
                  This week
                </div>
                <div>
                  {formatDateLabel(selected.currentCycle.weekStart)} to{' '}
                  {formatDateLabel(selected.currentCycle.weekEnd)}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <Badge tone={CYCLE_TONE[selected.currentCycle.status]}>
                    {CYCLE_LABEL[selected.currentCycle.status]}
                  </Badge>
                  <span className="gt-numeric" style={{ fontSize: 15 }}>
                    {formatMoney(selected.currentCycle.amountMinor, selected.currency)}
                  </span>
                </div>
              </div>
            ) : null}

            {actionError ? (
              <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{actionError}</div>
            ) : null}

            {selected.status === 'cancelled' ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                This plan has ended. It cannot be switched back on from here.
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={selected != null && confirmingCancel}
        title="Cancel this meal plan?"
        summary={
          selected ? (
            <>
              <strong>{selected.account.displayName || selected.account.email}</strong> stops
              getting these meals. Orders already placed for this week stay as they are, and the
              plan cannot be switched back on from here.
            </>
          ) : (
            ''
          )
        }
        details={
          selected
            ? [
                { label: 'Member', value: selected.account.displayName || selected.account.email },
                { label: 'Restaurant', value: selected.partner.name },
                {
                  label: 'Schedule',
                  value: scheduleLabel(selected.daysOfWeek, selected.window),
                },
                {
                  label: 'Price/day',
                  value: (
                    <span className="gt-numeric">
                      {formatMoney(selected.pricePerDayMinor, selected.currency)}
                    </span>
                  ),
                },
              ]
            : undefined
        }
        confirmLabel="Cancel plan"
        cancelLabel="Keep the plan"
        busy={busy}
        onCancel={() => setConfirmingCancel(false)}
        onConfirm={() => {
          setConfirmingCancel(false);
          void act('cancel');
        }}
      />
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
