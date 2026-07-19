'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Badge, Drawer } from '@/components/console';
import type { PartnerOrderDetail } from '../_data';

// Client-only: Leaflet touches `window` at import, so it must never SSR. Shown
// display-only (no drag/search) as a read-only rider pin.
const LocationPicker = dynamic(
  () => import('@/components/console/LocationPicker').then((m) => m.LocationPicker),
  { ssr: false, loading: () => null },
);
import {
  formatCountdown,
  formatDateLabel,
  formatMoney,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_LABEL,
  PAYMENT_STATUS_LABEL,
  windowLabel,
  windowStartMs,
} from '../_format';

/**
 * Read-only order detail panel for the Today board. Fetches the strict partner
 * projection + status timeline from `/api/partner/orders/[id]` (scoped
 * server-side to the caller's own restaurant), and shows the delivery-window
 * countdown, a tappable phone link, the line items, and the append-only event
 * history. No member identity is ever requested or shown.
 */
export function OrderDetailDrawer({
  orderId,
  currency,
  onClose,
}: {
  orderId: string;
  currency: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<PartnerOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/partner/orders/${encodeURIComponent(orderId)}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          if (alive) setError('Could not load this order.');
          return;
        }
        const body = (await res.json()) as { order: PartnerOrderDetail };
        if (alive) setDetail(body.order);
      } catch {
        if (alive) setError('Network error loading this order.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [orderId]);

  // Tick the countdown once a minute (no animation → reduced-motion safe).
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const startMs = detail ? windowStartMs(detail.deliveryDate, detail.window) : Number.NaN;
  const remaining = startMs - nowMs;

  return (
    <Drawer open onClose={onClose} title="Order detail" width={460}>
      {error ? (
        <div style={{ color: 'var(--gt-danger)', fontSize: 14 }}>{error}</div>
      ) : !detail ? (
        <div style={{ color: 'var(--gt-text-dim)', fontSize: 14 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 16 }}>{formatDateLabel(detail.deliveryDate)}</strong>
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{windowLabel(detail.window)}</div>
            </div>
            <Badge tone={ORDER_STATUS_TONE[detail.status]}>{ORDER_STATUS_LABEL[detail.status]}</Badge>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--gt-surface-sunken)',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {remaining > 0 ? 'Delivery window in' : 'Delivery window'}
            </span>
            <strong
              className="gt-numeric"
              style={{ fontSize: 16, color: remaining <= 0 ? 'var(--gt-danger)' : 'var(--gt-text)' }}
            >
              {formatCountdown(remaining)}
            </strong>
          </div>

          <Section title="Customer">
            <div style={{ fontSize: 16, fontWeight: 700 }}>{detail.deliveryName}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <a
                href={`tel:${detail.deliveryPhone.replace(/[^+\d]/g, '')}`}
                style={{ fontSize: 14, color: 'var(--gt-accent-strong)', textDecoration: 'none', fontWeight: 600 }}
              >
                {detail.deliveryPhone}
              </a>
              <CopyButton value={detail.deliveryPhone} label="Copy phone number" />
            </div>
            <div style={{ fontSize: 14, color: 'var(--gt-text-dim)', marginTop: 6 }}>
              {detail.deliveryAddressText}
            </div>
            {detail.deliveryNotes ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-faint)', marginTop: 6 }}>
                Note: {detail.deliveryNotes}
              </div>
            ) : null}
          </Section>

          <Section title="Delivery location">
            {detail.deliveryLat != null && detail.deliveryLng != null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <LocationPicker
                  mode="pin"
                  value={{ lat: detail.deliveryLat, lng: detail.deliveryLng }}
                  readOnly
                  searchEnabled={false}
                  height={200}
                  ariaLabel={`Delivery location for ${detail.deliveryName}`}
                />
                <a
                  href={`https://www.google.com/maps?q=${detail.deliveryLat},${detail.deliveryLng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--gt-accent-strong)',
                    textDecoration: 'none',
                  }}
                >
                  Open in Google Maps →
                </a>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gt-text-faint)' }}>
                No map pin — customer address is text-only.
              </div>
            )}
          </Section>

          <Section title="Items">
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detail.items.map((it, i) => (
                <li key={`${orderId}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, gap: 8 }}>
                  <span>
                    {it.qty}× {it.name}
                  </span>
                  <span style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>
                    {formatMoney(it.priceMinorSnapshot * it.qty, detail.currency)}
                  </span>
                </li>
              ))}
            </ul>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--gt-border)',
                fontSize: 15,
              }}
            >
              <strong>Total</strong>
              <strong>{formatMoney(detail.totalMinor, detail.currency)}</strong>
            </div>
            <div style={{ fontSize: 12, color: 'var(--gt-text-faint)', marginTop: 6 }}>
              {PAYMENT_LABEL[detail.paymentMethod] ?? detail.paymentMethod} ·{' '}
              {PAYMENT_STATUS_LABEL[detail.paymentStatus] ?? detail.paymentStatus}
            </div>
          </Section>

          <Section title="Timeline">
            {detail.timeline.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-faint)' }}>No events recorded.</div>
            ) : (
              <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.timeline.map((ev, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                    <span
                      className="gt-numeric"
                      style={{ color: 'var(--gt-text-faint)', whiteSpace: 'nowrap', minWidth: 96 }}
                    >
                      {formatEventTime(ev.createdAt)}
                    </span>
                    <span style={{ color: 'var(--gt-text-dim)' }}>
                      {ev.fromStatus ? `${ORDER_STATUS_LABEL[ev.fromStatus]} → ` : ''}
                      <strong style={{ color: 'var(--gt-text)' }}>{ORDER_STATUS_LABEL[ev.toStatus]}</strong>
                      {ev.actorRole ? ` · ${ev.actorRole}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      )}
    </Drawer>
  );
}

/** Copy a value to the clipboard with a brief "Copied" confirmation. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the tel: link is still tappable */
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      style={{
        border: '1px solid var(--gt-border)',
        borderRadius: 6,
        padding: '2px 8px',
        background: 'var(--gt-surface-sunken)',
        color: copied ? 'var(--gt-success, var(--gt-accent-strong))' : 'var(--gt-text-dim)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--gt-text-faint)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** `2026-07-18T09:15:00Z` → `Jul 18, 14:00` in KTM wall-clock. */
function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ktm = new Date(d.getTime() + (5 * 60 + 45) * 60 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(ktm.getUTCHours()).padStart(2, '0');
  const mm = String(ktm.getUTCMinutes()).padStart(2, '0');
  return `${months[ktm.getUTCMonth()]} ${ktm.getUTCDate()}, ${hh}:${mm}`;
}
