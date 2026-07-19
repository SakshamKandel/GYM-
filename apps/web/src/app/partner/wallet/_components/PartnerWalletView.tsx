'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Partner wallet client view (WP-5, Pack I). Renders the withdrawable held
 * balance, a request-payout form (or the current pending request), and the
 * wallet-ledger + payout-request history. All money is integer minor units; the
 * form converts the major-unit input before POSTing. The server re-validates
 * everything (amount bound, one-pending) — this UI only pre-flights for UX.
 */

interface LedgerEntry {
  id: string;
  type: 'earning' | 'adjustment' | 'payout';
  amountMinor: number;
  currency: string;
  sourceType: string | null;
  note: string | null;
  createdAt: string;
}

interface PayoutRequest {
  id: string;
  currency: string;
  amountMinor: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  note: string | null;
  disbursementRef: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

interface Props {
  currency: string;
  heldMinor: number;
  earnedMinor: number;
  paidOutMinor: number;
  ledger: LedgerEntry[];
  requests: PayoutRequest[];
  initialPending: PayoutRequest | null;
}

/** `100000, 'NPR'` → `Rs 1,000` · `1000, 'USD'` → `$10.00`. */
function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return currency === 'NPR'
    ? `Rs ${major.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${major.toFixed(2)}`;
}

const MIN_PAYOUT_MINOR: Record<string, number> = { NPR: 100_000, USD: 1_000 };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_LABEL: Record<PayoutRequest['status'], string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Not approved',
  paid: 'Paid',
};

const STATUS_COLOR: Record<PayoutRequest['status'], string> = {
  pending: 'var(--gt-warning)',
  approved: 'var(--gt-success)',
  rejected: 'var(--gt-danger)',
  paid: 'var(--gt-success)',
};

function errorMessage(code: string, currency: string, heldMinor: number): string {
  switch (code) {
    case 'below_minimum':
      return `The minimum payout is ${formatMoney(MIN_PAYOUT_MINOR[currency] ?? MIN_PAYOUT_MINOR.NPR, currency)}.`;
    case 'insufficient_balance':
      return `You can request up to ${formatMoney(heldMinor, currency)}.`;
    case 'already_pending':
      return 'You already have a pending payout request.';
    default:
      return 'Could not submit your request. Please try again.';
  }
}

export function PartnerWalletView({
  currency,
  heldMinor,
  earnedMinor,
  paidOutMinor,
  ledger,
  requests,
  initialPending,
}: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const minMinor = MIN_PAYOUT_MINOR[currency] ?? MIN_PAYOUT_MINOR.NPR;
  const canRequest = heldMinor >= minMinor && !initialPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const major = Number(amount);
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    const amountMinor = Math.round(major * 100);
    if (amountMinor < minMinor) {
      setError(errorMessage('below_minimum', currency, heldMinor));
      return;
    }
    if (amountMinor > heldMinor) {
      setError(errorMessage('insufficient_balance', currency, heldMinor));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/partner/payouts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountMinor }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errorMessage(body.error ?? '', currency, heldMinor));
        setSubmitting(false);
        return;
      }
      setAmount('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Held balance */}
      <div
        style={{
          border: '1px solid var(--gt-border)',
          borderRadius: 14,
          padding: 20,
          background: 'var(--gt-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Available to withdraw</span>
        <span className="gt-numeric" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>
          {formatMoney(heldMinor, currency)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
          {formatMoney(earnedMinor, currency)} earned · {formatMoney(paidOutMinor, currency)} paid out
        </span>
      </div>

      {/* Request form OR pending state */}
      {initialPending ? (
        <div
          style={{
            border: '1px solid var(--gt-border)',
            borderRadius: 14,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Payout request pending · {formatMoney(initialPending.amountMinor, currency)}
          </span>
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Requested {formatDate(initialPending.requestedAt)}. An admin will review and disburse it.
            You can file another once this one is decided.
          </span>
        </div>
      ) : (
        <form
          onSubmit={submit}
          style={{
            border: '1px solid var(--gt-border)',
            borderRadius: 14,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Request a payout</span>
          {canRequest ? (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  Amount ({currency}) · min {formatMoney(minMinor, currency)}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`Up to ${formatMoney(heldMinor, currency)}`}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--gt-border)',
                    background: 'var(--gt-surface-sunken)',
                    color: 'var(--gt-text)',
                    fontSize: 15,
                  }}
                />
              </label>
              {error ? (
                <span style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{error}</span>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--gt-accent-strong)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: submitting ? 'default' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? 'Submitting…' : 'Request payout'}
              </button>
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              You need at least {formatMoney(minMinor, currency)} in held revenue to request a payout.
            </span>
          )}
        </form>
      )}

      {/* Payout request history */}
      {requests.length > 0 ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)', fontWeight: 600 }}>
            Payout requests
          </span>
          <div
            style={{
              border: '1px solid var(--gt-border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {requests.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--gt-border)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span className="gt-numeric" style={{ fontSize: 14, fontWeight: 600 }}>
                    {formatMoney(r.amountMinor, r.currency)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
                    {formatDate(r.requestedAt)}
                    {r.disbursementRef ? ` · ref ${r.disbursementRef}` : ''}
                  </span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[r.status] }}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Wallet ledger */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--gt-text-dim)', fontWeight: 600 }}>
          Wallet history
        </span>
        {ledger.length === 0 ? (
          <div
            style={{
              border: '1px solid var(--gt-border)',
              borderRadius: 12,
              padding: 18,
              fontSize: 13,
              color: 'var(--gt-text-dim)',
            }}
          >
            No wallet movements yet. Payouts and adjustments appear here.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--gt-border)', borderRadius: 12, overflow: 'hidden' }}>
            {ledger.map((entry, i) => {
              // Payout rows carry a positive magnitude but represent money OUT;
              // an adjustment can be signed. Derive the display sign accordingly.
              const outflow = entry.type === 'payout' || entry.amountMinor < 0;
              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 14px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--gt-border)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 14, textTransform: 'capitalize' }}>{entry.type}</span>
                    <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
                      {formatDate(entry.createdAt)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </span>
                  </div>
                  <span
                    className="gt-numeric"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: outflow ? 'var(--gt-danger)' : 'var(--gt-success)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {outflow ? '−' : '+'}
                    {formatMoney(Math.abs(entry.amountMinor), entry.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
