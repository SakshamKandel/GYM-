'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, ConfirmButton, EmptyState } from '@/components/console';
import type { PartnerMenuItem, PartnerStoreState } from '../_data';
import { formatMoney } from '../_format';

/**
 * Store controls — the accepting-orders switch + a per-item out-of-stock grid.
 *
 * Pause/resume changes the partner-level accepting-orders switch. Per-item
 * controls remain independent, so resuming never republishes a sold-out dish.
 */
export function StoreControls({
  menu,
  store,
  currency,
}: {
  menu: PartnerMenuItem[];
  store: PartnerStoreState;
  currency: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStore(action: 'pause' | 'resume') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setError('Could not update the store status. Try again.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      <Card>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ fontSize: 18 }}>
                {store.paused ? 'Store paused' : 'Accepting orders'}
              </strong>
              <Badge tone={store.paused ? 'critical' : 'positive'}>
                {store.paused ? 'Paused' : 'Open'}
              </Badge>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--gt-text-dim)', maxWidth: '56ch' }}>
              {store.paused
                ? 'Members cannot place new orders. Existing orders are unaffected — finish and deliver them as normal. Resume when you are ready to take orders again.'
                : 'Your kitchen is live. Pause to stop taking new orders while you are on holiday or fully booked, without hiding items one by one.'}
            </p>
          </div>
          <div style={{ flexShrink: 0 }}>
            {store.paused ? (
              <ConfirmButton
                label="Resume orders"
                confirmLabel="Confirm resume"
                busyLabel="Resuming…"
                busy={busy}
                onConfirm={() => void setStore('resume')}
              />
            ) : store.totalMeals === 0 ? (
              <span style={{ fontSize: 13, color: 'var(--gt-text-faint)' }}>Add a menu item first</span>
            ) : (
              <ConfirmButton
                label="Pause new orders"
                confirmLabel="Confirm pause"
                busyLabel="Pausing…"
                busy={busy}
                onConfirm={() => void setStore('pause')}
              />
            )}
          </div>
        </div>
        {store.paused ? (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--gt-text-faint)' }}>
            Individual item availability is preserved while the store is paused.
          </p>
        ) : null}
        {error ? (
          <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 10 }}>{error}</div>
        ) : null}
      </Card>

      <Card padded={false}>
        <CardHeader
          title="Item availability"
          action={
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              {store.activeMeals}/{store.totalMeals} available
            </span>
          }
        />
        {menu.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState
              title="No menu items"
              description="Add items on the Menu page before setting availability."
            />
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {menu.map((item) => (
              <StockRow key={item.id} item={item} currency={currency} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StockRow({ item, currency }: { item: PartnerMenuItem; currency: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/partner/meals/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 18px',
        borderBottom: '1px solid var(--gt-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              background: 'var(--gt-surface-sunken)',
              flexShrink: 0,
            }}
            aria-hidden
          />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </div>
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            {formatMoney(item.priceMinor, currency)}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Badge tone={item.isActive ? 'positive' : 'neutral'}>
          {item.isActive ? 'Available' : 'Out of stock'}
        </Badge>
        <Button size="sm" disabled={busy} onClick={() => void toggle()}>
          {busy ? '…' : item.isActive ? 'Mark out of stock' : 'Mark available'}
        </Button>
        {error ? <span style={{ color: 'var(--gt-danger)', fontSize: 12 }}>Failed</span> : null}
      </div>
    </li>
  );
}
