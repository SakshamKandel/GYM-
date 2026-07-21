'use client';

import { ORDER_STATUSES, canActorAdvance, formatMoney, orderNumber, type OrderStatus } from '@gym/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Drawer,
  SearchField,
  StatusChip,
  Toolbar,
} from '@/components/console';
import { DownloadCsv } from '../../_components/DownloadCsv';
import type { AdminOrderRow } from '../_data';
import { OrderTimeline } from './OrderTimeline';

// Client-only: Leaflet touches `window` at import, so never SSR this.
const LocationPicker = dynamic(
  () => import('@/components/console/LocationPicker').then((m) => m.LocationPicker),
  { ssr: false, loading: () => null },
);

/**
 * Admin all-partner order oversight (plan §2/§3/§7 P6). Toolbar+DataTable+
 * review Drawer (queue-page template): server-driven date/partner/status/scope
 * filters AND the free-text search box all re-fetch the guarded API route
 * (B14 — search used to filter only the already-fetched page; a debounced
 * `q` param now matches the full server-side set, same idiom as the members
 * directory). The Drawer's action buttons are computed from
 * `canActorAdvance(from, to, 'admin')` — this UI can never offer a transition
 * the server would reject, and `POST …/override` re-validates it anyway.
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refused: 'Refused',
};

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'positive' | 'warning' | 'critical' | 'info'> = {
  pending: 'warning',
  confirmed: 'info',
  preparing: 'info',
  out_for_delivery: 'info',
  delivered: 'positive',
  cancelled: 'neutral',
  refused: 'critical',
};

/** Same semantic status-color language as the partner ops board (CSS vars). */
const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: 'var(--gt-warning)',
  confirmed: 'var(--gt-info)',
  preparing: 'var(--gt-info)',
  out_for_delivery: 'var(--gt-accent)',
  delivered: 'var(--gt-success)',
  cancelled: 'var(--gt-text-faint)',
  refused: 'var(--gt-danger)',
};

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

async function parseErrorCode(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

function friendlyError(status: number, code: string | null): string {
  switch (code) {
    case 'illegal_transition':
      return 'That status change is no longer valid for this order.';
    case 'conflict':
      return 'This order changed elsewhere — refreshing.';
    case 'not_found':
      return 'This order no longer exists.';
    default:
      break;
  }
  if (status === 403) return 'You are not allowed to review orders.';
  return 'Something went wrong. Try again.';
}

export function OrdersOversight({
  initialOrders,
  partners,
}: {
  initialOrders: AdminOrderRow[];
  partners: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrderRow[]>(initialOrders);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [scope, setScope] = useState<'active' | 'history' | 'all'>('active');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Re-fetch from the guarded API whenever a server-side filter changes,
  // debouncing the free-text search box so each keystroke doesn't fire a
  // round trip (B14 — `q` is matched against the FULL table server-side, not
  // just the already-fetched page; mirrors the members directory's pattern).
  // Skip the very first render — the page already server-loaded the default
  // (scope=active, no other filters) view.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (partnerId) params.set('partnerId', partnerId);
      if (status) params.set('status', status);
      params.set('scope', scope);
      if (query.trim()) params.set('q', query.trim());
      void (async () => {
        try {
          const res = await fetch(`/api/admin/orders?${params.toString()}`, {
            credentials: 'include',
            signal: controller.signal,
          });
          if (!res.ok) {
            setLoading(false);
            return;
          }
          const data = (await res.json()) as { orders: AdminOrderRow[] };
          setOrders(data.orders);
          setLoading(false);
        } catch {
          if (controller.signal.aborted) return;
          setLoading(false);
        }
      })();
    }, query.trim() ? 300 : 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, partnerId, status, scope, query]);

  // CSV export mirrors the ACTIVE server-side filters (date/partnerId/status/
  // scope) so "download" always matches what the board is currently showing —
  // the export route (owned outside this package) has no `q` param; it's a
  // date/partner/status/scope rollup by design, not a search-result dump.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (partnerId) params.set('partnerId', partnerId);
    if (status) params.set('status', status);
    params.set('scope', scope);
    const qs = params.toString();
    return `/api/admin/exports/meal-orders${qs ? `?${qs}` : ''}`;
  }, [date, partnerId, status, scope]);

  // The server already applies `q` against the full matching set (B14); no
  // client-side re-filtering here — `orders` IS the filtered set.
  const filtered = orders;

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const availableTargets = useMemo(() => {
    if (!selected) return [];
    return ORDER_STATUSES.filter(
      (to) => to !== selected.status && canActorAdvance(selected.status, to, 'admin'),
    );
  }, [selected]);

  function openRow(row: AdminOrderRow) {
    setSelectedId(row.id);
    setReason('');
    setDrawerError(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
  }

  async function override(toStatus: OrderStatus) {
    if (!selected) return;
    setBusy(true);
    setDrawerError(null);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(selected.id)}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          toStatus,
          // B13: a refuse also carries the typed reason — the server used to
          // only persist it for 'cancelled', silently discarding what an admin
          // typed into the SAME textarea when refusing instead.
          reason:
            toStatus === 'cancelled' || toStatus === 'refused'
              ? reason.trim() || undefined
              : undefined,
        }),
      });
      if (!res.ok) {
        const code = await parseErrorCode(res);
        setDrawerError(friendlyError(res.status, code));
        setBusy(false);
        if (code === 'conflict' || code === 'not_found') {
          setSelectedId(null);
          router.refresh();
        }
        return;
      }
      setBusy(false);
      setSelectedId(null);
      router.refresh();
    } catch {
      setDrawerError('Network error.');
      setBusy(false);
    }
  }

  const columns: Column<AdminOrderRow>[] = [
    {
      key: 'order',
      header: 'Order',
      width: 110,
      render: (r) => (
        <span
          className="gt-numeric"
          style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--gt-text)' }}
        >
          {orderNumber(r.id)}
        </span>
      ),
    },
    {
      key: 'placed',
      header: 'Placed',
      width: 130,
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {DATE_FMT.format(new Date(r.placedAt))}
        </span>
      ),
    },
    {
      key: 'partner',
      header: 'Partner',
      render: (r) => <span style={{ fontSize: 13 }}>{r.partnerName}</span>,
    },
    {
      key: 'member',
      header: 'Member',
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{r.accountDisplayName || r.accountEmail}</div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.accountEmail}</div>
        </div>
      ),
    },
    {
      key: 'delivery',
      header: 'Delivery',
      width: 140,
      render: (r) => (
        <span style={{ fontSize: 12 }}>
          {r.deliveryDate} · {r.window}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 150,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: STATUS_COLOR[r.status],
              flexShrink: 0,
            }}
          />
          <StatusChip status={r.status === 'delivered' ? 'live' : r.status === 'pending' ? 'pending' : r.status === 'cancelled' || r.status === 'refused' ? 'ended' : 'active'} label={STATUS_LABEL[r.status]} />
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      width: 100,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {formatMoney(r.totalMinor, r.currency)}
        </span>
      ),
    },
  ];

  return (
    <>
      <Toolbar
        left={
          <SearchField
            placeholder="Search partner or member…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        right={
          <>
            <input
              type="date"
              className="gt-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Filter by delivery date"
            />
            <select
              className="gt-input"
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              aria-label="Filter by partner"
            >
              <option value="">All partners</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="gt-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              className="gt-input"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'active' | 'history' | 'all')}
              aria-label="Filter by scope"
            >
              <option value="active">Active</option>
              <option value="history">History</option>
              <option value="all">All</option>
            </select>
            <DownloadCsv href={exportHref} />
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={openRow}
        empty={loading ? 'Loading…' : 'No orders match these filters.'}
      />

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected ? `${selected.partnerName} · ${selected.deliveryDate}` : 'Order'}
        width={460}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusChip
                status={selected.status === 'delivered' ? 'live' : selected.status === 'pending' ? 'pending' : selected.status === 'cancelled' || selected.status === 'refused' ? 'ended' : 'active'}
                label={STATUS_LABEL[selected.status]}
              />
              <Badge tone="info">{selected.source === 'subscription' ? 'Subscription' : 'One-time'}</Badge>
              <Badge tone="neutral">{selected.window}</Badge>
            </div>

            <Row label="Member">
              {selected.accountDisplayName || selected.accountEmail}
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{selected.accountEmail}</div>
            </Row>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
              <Row label="Delivery date">{selected.deliveryDate}</Row>
              <Row label="Delivery window">{selected.window}</Row>
              <Row label="Payment method">{selected.paymentMethod}</Row>
              <Row label="Payment status">{selected.paymentStatus}</Row>
              <Row label="Subtotal">{formatMoney(selected.subtotalMinor, selected.currency)}</Row>
              <Row label="Total">{formatMoney(selected.totalMinor, selected.currency)}</Row>
            </div>

            <Row label="Delivery address">
              {selected.deliveryName} · {selected.deliveryPhone}
              <div>{selected.deliveryAddressText}</div>
              {selected.deliveryNotes ? (
                <div style={{ color: 'var(--gt-text-dim)', marginTop: 4 }}>{selected.deliveryNotes}</div>
              ) : null}
              {selected.deliveryLat != null && selected.deliveryLng != null ? (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <LocationPicker
                    mode="pin"
                    value={{ lat: selected.deliveryLat, lng: selected.deliveryLng }}
                    readOnly
                    searchEnabled={false}
                    height={200}
                    ariaLabel="Delivery location"
                  />
                  <a
                    href={`https://www.google.com/maps?q=${selected.deliveryLat},${selected.deliveryLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      alignSelf: 'flex-start',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--gt-accent-strong)',
                      textDecoration: 'none',
                    }}
                  >
                    Open in Google Maps →
                  </a>
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  No map pin — customer address is text-only.
                </div>
              )}
            </Row>

            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  marginBottom: 6,
                }}
              >
                Items
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {selected.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>
                      {it.qty}× {it.name}
                    </span>
                    <span className="gt-numeric">{formatMoney(it.priceMinorSnapshot * it.qty, selected.currency)}</span>
                  </div>
                ))}
              </div>
            </div>

            {selected.cancelReason ? <Row label="Reason">{selected.cancelReason}</Row> : null}

            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  marginBottom: 6,
                }}
              >
                History
              </div>
              <OrderTimeline orderId={selected.id} />
            </div>

            {availableTargets.length > 0 ? (
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {availableTargets.includes('cancelled') || availableTargets.includes('refused') ? (
                  <textarea
                    className="gt-input"
                    placeholder="Reason (shown in the order history)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    disabled={busy}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  />
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {availableTargets.map((to) => (
                    <Button
                      key={to}
                      variant={to === 'cancelled' || to === 'refused' ? 'danger' : 'primary'}
                      size="sm"
                      disabled={busy}
                      onClick={() => void override(to)}
                    >
                      {busy ? 'Working…' : `Mark ${STATUS_LABEL[to].toLowerCase()}`}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                This order is in a terminal state — no further action.
              </div>
            )}

            {drawerError ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{drawerError}</div> : null}
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
