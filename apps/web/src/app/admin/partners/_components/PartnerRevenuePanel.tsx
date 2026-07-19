'use client';

import { useEffect, useState } from 'react';

/**
 * Per-partner revenue panel for the admin partners drawer. Fetches the read-only
 * `/api/admin/partners/[id]/revenue` breakdown and shows delivered-order money
 * split by where it lives: COD the restaurant already collected at the door vs.
 * digital (eSewa/Khalti) the PLATFORM still holds and owes out (the payout
 * precursor). Refunds are netted out of every earned figure and shown separately.
 * Two windows: this KTM month, and all time.
 */

interface RevenueBucket {
  deliveredOrders: number;
  grossMinor: number;
  codCollectedMinor: number;
  digitalHeldMinor: number;
  refundedOrders: number;
  refundedMinor: number;
}

interface RevenueResponse {
  partnerId: string;
  currency: string;
  thisMonth: RevenueBucket;
  allTime: RevenueBucket;
  /** Net owed — withdrawable held that decrements as payouts post (B27). */
  heldMinor: number;
  paidOutMinor: number;
  ledgerDerived: boolean;
}

/** `25000, 'NPR'` → `Rs 250` · `250, 'USD'` → `$2.50`. */
function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return currency === 'NPR' ? `Rs ${major.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${major.toFixed(2)}`;
}

export function PartnerRevenuePanel({ partnerId }: { partnerId: string }) {
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/admin/partners/${encodeURIComponent(partnerId)}/revenue`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? 'forbidden' : 'failed');
        return (await res.json()) as RevenueResponse;
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error && err.message === 'forbidden' ? 'Not allowed.' : 'Could not load revenue.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  return (
    <div style={{ paddingTop: 16, borderTop: '1px solid var(--gt-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
          }}
        >
          Revenue
        </span>
        <span style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>Delivered orders only</span>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Loading revenue…</div>
      ) : error ? (
        <div style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{error}</div>
      ) : data ? (
        <>
          {/*
            Net owed — the money-truth figure. Unlike the gross "Digital held"
            below (a raw sum), this decrements as payouts are disbursed (B27), so
            it reflects what the platform actually still owes the partner.
          */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              padding: '10px 12px',
              border: '1px solid var(--gt-border)',
              borderRadius: 10,
              background: 'var(--gt-surface-sunken)',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              Net owed
              <span style={{ color: 'var(--gt-text-faint)' }}>
                {' '}
                · after {formatMoney(data.paidOutMinor, data.currency)} paid out
              </span>
            </span>
            <span className="gt-numeric" style={{ fontSize: 17, fontWeight: 600 }}>
              {formatMoney(data.heldMinor, data.currency)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <BucketCard title="This month" bucket={data.thisMonth} currency={data.currency} />
            <BucketCard title="All time" bucket={data.allTime} currency={data.currency} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function BucketCard({ title, bucket, currency }: { title: string; bucket: RevenueBucket; currency: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--gt-border)',
        borderRadius: 10,
        padding: 12,
        background: 'var(--gt-surface-sunken)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 13 }}>{title}</span>
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {bucket.deliveredOrders.toLocaleString()} order{bucket.deliveredOrders === 1 ? '' : 's'}
        </span>
      </div>
      <Line label="Gross" value={formatMoney(bucket.grossMinor, currency)} strong />
      <Line label="COD collected" value={formatMoney(bucket.codCollectedMinor, currency)} hint="by restaurant" />
      <Line label="Digital held" value={formatMoney(bucket.digitalHeldMinor, currency)} hint="by platform" />
      {bucket.refundedOrders > 0 ? (
        <Line
          label="Refunded"
          value={formatMoney(bucket.refundedMinor, currency)}
          hint={`${bucket.refundedOrders} · not counted`}
          danger
        />
      ) : null}
    </div>
  );
}

function Line({
  label,
  value,
  hint,
  strong,
  danger,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, color: danger ? 'var(--gt-danger)' : 'var(--gt-text-dim)', minWidth: 0 }}>
        {label}
        {hint ? <span style={{ color: 'var(--gt-text-faint)' }}> · {hint}</span> : null}
      </span>
      <span
        className="gt-numeric"
        style={{
          fontSize: strong ? 15 : 13,
          fontWeight: strong ? 600 : 400,
          color: danger ? 'var(--gt-danger)' : 'var(--gt-text)',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}
