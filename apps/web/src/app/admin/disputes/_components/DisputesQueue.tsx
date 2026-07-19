'use client';

import { formatMoney } from '@gym/shared';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
} from '@/components/console';

/**
 * Admin dispute queue (Pack E non-delivery rail / WP-8). Master/detail —
 * DataTable of every open/reviewing dispute (or a decided tab) opens a Drawer
 * with the member's reason/note, the linked order, and the resolve/reject
 * controls. `POST /api/admin/disputes/[id]` is ADMIN-AUTHORITATIVE and never
 * auto-refunds — a dispute that should get money back is refunded separately
 * on the Meal Payments queue; this drawer only records the outcome and tells
 * the member.
 */

export interface DisputeRow {
  id: string;
  orderId: string;
  orderNumber: string;
  account: { id: string; email: string; displayName: string };
  partnerName: string;
  order: {
    totalMinor: number;
    currency: string;
    status: string;
    paymentStatus: string;
    deliveryDate: string;
    window: string;
  };
  reason: string;
  note: string;
  status: 'open' | 'reviewing' | 'resolved' | 'rejected';
  resolution: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const TABS = [
  { key: 'live', label: 'Open + reviewing' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const REASON_LABEL: Record<string, string> = {
  not_delivered: 'Not delivered',
  wrong_items: 'Wrong items',
  quality: 'Quality issue',
  late: 'Arrived late',
  other: 'Other',
};

const STATUS_TONE: Record<DisputeRow['status'], 'warning' | 'info' | 'positive' | 'critical'> = {
  open: 'warning',
  reviewing: 'info',
  resolved: 'positive',
  rejected: 'critical',
};

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** The `status` query value each tab sends (page server-loads only the live
 * queue; a decided tab fetches on demand — dispute volume is small, so this
 * is a light on-demand round trip, not a paginated table). */
const TAB_STATUS: Record<TabKey, string | undefined> = {
  live: undefined, // uses the initial server-loaded prop, refreshed via router.refresh()
  resolved: 'resolved',
  rejected: 'rejected',
  all: 'all',
};

export function DisputesQueue({ disputes: initialDisputes }: { disputes: DisputeRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('live');
  const [rows, setRows] = useState<DisputeRow[]>(initialDisputes);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Loads the given tab's rows — the server-passed prop for 'live', an
   * on-demand fetch for decided tabs (dispute volume is small: one light
   * round trip per tab switch, not a paginated table). */
  async function loadTab(t: TabKey) {
    if (t === 'live') {
      setRows(initialDisputes);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/disputes?status=${TAB_STATUS[t]}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { disputes: DisputeRow[] };
      setRows(data.disputes);
    } finally {
      setLoading(false);
    }
  }

  // Reset to the server-loaded live queue whenever the underlying prop changes
  // (e.g. after router.refresh() following a decision made while on 'live').
  useEffect(() => {
    if (tab === 'live') setRows(initialDisputes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDisputes]);

  const primed = useRef(false);
  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      return;
    }
    void loadTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filtered = rows;
  const selected = rows.find((d) => d.id === selectedId) ?? null;

  function openRow(row: DisputeRow) {
    setSelectedId(row.id);
    setResolution('');
    setError(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
  }

  async function decide(toStatus: 'reviewing' | 'resolved' | 'rejected') {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/disputes/${encodeURIComponent(selected.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toStatus, resolution: resolution.trim() || undefined }),
      });
      if (!res.ok) {
        setError(
          res.status === 409
            ? 'This dispute already changed elsewhere — refreshing.'
            : res.status === 403
              ? 'You are not allowed to review disputes.'
              : 'Could not save that decision. Try again.',
        );
        setBusy(false);
        if (res.status === 409) {
          setSelectedId(null);
          router.refresh();
          void loadTab(tab);
        }
        return;
      }
      setBusy(false);
      setSelectedId(null);
      // Refresh the server-loaded 'live' queue (stat tiles included) AND the
      // currently-viewed tab's own rows, so a decision made from 'all'/
      // 'resolved'/'rejected' doesn't leave a stale row behind.
      router.refresh();
      void loadTab(tab);
    } catch {
      setError('Network error.');
      setBusy(false);
    }
  }

  const columns: Column<DisputeRow>[] = [
    {
      key: 'order',
      header: 'Order',
      width: 110,
      render: (r) => <span className="gt-numeric" style={{ fontSize: 13 }}>{r.orderNumber}</span>,
    },
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{r.account.displayName || r.account.email}</div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.partnerName}</div>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => <span style={{ fontSize: 13 }}>{REASON_LABEL[r.reason] ?? r.reason}</span>,
    },
    {
      key: 'age',
      header: 'Age',
      width: 70,
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {relativeAge(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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

      {tab === 'live' && rows.length === 0 && !loading ? (
        <EmptyState
          title="No disputes yet"
          description="When a member reports a problem with a delivered order, it lands here for review."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={openRow}
          empty={loading ? 'Loading…' : 'No disputes match this view.'}
        />
      )}

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? `Order ${selected.orderNumber}` : 'Dispute'}
        width={460}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={STATUS_TONE[selected.status]}>
                {selected.status[0].toUpperCase() + selected.status.slice(1)}
              </Badge>
              <Badge tone="neutral">{REASON_LABEL[selected.reason] ?? selected.reason}</Badge>
            </div>

            <Row label="Member">
              {selected.account.displayName || selected.account.email}
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{selected.account.email}</div>
            </Row>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
              <Row label="Partner">{selected.partnerName}</Row>
              <Row label="Order total">{formatMoney(selected.order.totalMinor, selected.order.currency)}</Row>
              <Row label="Delivery">{selected.order.deliveryDate} · {selected.order.window}</Row>
              <Row label="Order status">{selected.order.status}</Row>
            </div>

            <Row label="Member note">{selected.note || '—'}</Row>

            {selected.resolution ? <Row label="Resolution">{selected.resolution}</Row> : null}

            {selected.status === 'open' || selected.status === 'reviewing' ? (
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <textarea
                  className="gt-input"
                  placeholder="Resolution note (shown to the member)"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  disabled={busy}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  Resolving does not refund automatically — issue a refund from the Meal Payments
                  queue first if money should move back.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selected.status === 'open' ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide('reviewing')}>
                      Start review
                    </Button>
                  ) : null}
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => void decide('resolved')}>
                    {busy ? 'Working…' : 'Mark resolved'}
                  </Button>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => void decide('rejected')}>
                    {busy ? 'Working…' : 'Reject'}
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                This dispute is closed — no further action.
              </div>
            )}

            {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}
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
