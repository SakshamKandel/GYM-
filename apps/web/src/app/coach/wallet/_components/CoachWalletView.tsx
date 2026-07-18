'use client';

import { formatMoney } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, EmptyState, TextField } from '@/components/console';

export interface WalletBalance {
  currency: string;
  amountMinor: number;
}

export interface LedgerEntry {
  id: string;
  type: 'commission' | 'adjustment' | 'payout';
  amountMinor: number;
  currency: string;
  note: string | null;
  createdAt: string;
}

export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface PayoutRequest {
  id: string;
  currency: string;
  amountMinor: number;
  status: PayoutStatus;
  note: string | null;
  disbursementRef: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

export interface PromoCode {
  code: string;
  discountPct: number;
  commissionPct: number;
  redemptionCount: number;
}

const CURRENCIES = ['NPR', 'USD'] as const;
type Currency = (typeof CURRENCIES)[number];

/**
 * Client-side mirror of the server's per-currency minimum (minor units) — used
 * for immediate UX feedback only; POST /api/coach/payouts is authoritative.
 */
const MIN_PAYOUT_MINOR: Record<Currency, number> = { NPR: 100_000, USD: 1_000 };

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const TYPE_LABEL: Record<LedgerEntry['type'], string> = {
  commission: 'Commission',
  adjustment: 'Adjustment',
  payout: 'Payout',
};

const STATUS_TONE: Record<PayoutStatus, 'neutral' | 'positive' | 'warning'> = {
  pending: 'warning',
  approved: 'positive',
  paid: 'positive',
  rejected: 'neutral',
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
};

function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Coach wallet view (plan §3 P1-13). Shows the coach's balances + promo code,
 * hosts the request-payout form (one open request at a time — enforced by the
 * server's partial unique index and reflected here), and lists payout requests
 * plus the raw ledger. On a successful request we router.refresh() so the
 * server-rendered lists re-load.
 */
export function CoachWalletView({
  balances,
  entries,
  payouts,
  code,
}: {
  balances: WalletBalance[];
  entries: LedgerEntry[];
  payouts: PayoutRequest[];
  code: PromoCode | null;
}) {
  const router = useRouter();

  const balanceCurrencies = balances.filter((b) => b.amountMinor > 0).map((b) => b.currency);
  const initialCurrency: Currency =
    balanceCurrencies.find(isCurrency) ?? 'NPR';

  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = payouts.find((p) => p.status === 'pending') ?? null;

  const balanceFor = (c: string) =>
    balances.find((b) => b.currency === c)?.amountMinor ?? 0;

  async function requestPayout() {
    const major = Number(amount);
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    const amountMinor = Math.round(major * 100);
    if (amountMinor < MIN_PAYOUT_MINOR[currency]) {
      setError(
        `Minimum payout is ${formatMoney(MIN_PAYOUT_MINOR[currency], currency)}.`,
      );
      return;
    }
    if (amountMinor > balanceFor(currency)) {
      setError('That is more than your current balance in this currency.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/coach/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amountMinor, currency }),
      });
      if (!res.ok) {
        let apiError: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          apiError = typeof data.error === 'string' ? data.error : null;
        } catch {
          apiError = null;
        }
        setError(
          apiError === 'already_pending'
            ? 'You already have a payout request awaiting review.'
            : apiError === 'insufficient_balance'
              ? 'That is more than your current balance in this currency.'
              : apiError === 'below_minimum'
                ? `Minimum payout is ${formatMoney(MIN_PAYOUT_MINOR[currency], currency)}.`
                : 'Could not submit that payout request. Try again.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setAmount('');
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Balances */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {balances.length === 0 ? (
          <span style={{ fontSize: 14, color: 'var(--gt-text-dim)' }}>
            No balance yet. Commission lands automatically when someone buys with your promo
            code.
          </span>
        ) : (
          balances.map((b) => (
            <div key={b.currency} className="gt-card" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>{b.currency}</div>
              <div className="gt-numeric" style={{ fontSize: 22 }}>
                {formatMoney(b.amountMinor, b.currency)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Promo code */}
      {code ? (
        <div
          className="gt-card"
          style={{ padding: '12px 16px', display: 'flex', gap: 20, flexWrap: 'wrap' }}
        >
          <div>
            <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>Your code</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 16 }}>
              {code.code}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>Discount / commission</div>
            <div style={{ fontSize: 15 }}>
              {code.discountPct}% off · {code.commissionPct}% to you
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>Redemptions</div>
            <div className="gt-numeric" style={{ fontSize: 15 }}>
              {code.redemptionCount}
            </div>
          </div>
        </div>
      ) : null}

      {/* Request payout */}
      <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--gt-border)' }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
            marginBottom: 12,
          }}
        >
          Request a payout
        </div>

        {pending ? (
          <div style={{ fontSize: 14, color: 'var(--gt-text-dim)' }}>
            You have a pending payout request for{' '}
            <strong style={{ color: 'var(--gt-text)' }}>
              {formatMoney(pending.amountMinor, pending.currency)}
            </strong>
            . An admin will review it shortly — you can request another once it is decided.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <TextField
                label="Amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={saving}
                style={{ flex: 1 }}
              />
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Currency</span>
                <select
                  className="gt-input"
                  value={currency}
                  onChange={(e) => {
                    if (isCurrency(e.target.value)) setCurrency(e.target.value);
                  }}
                  disabled={saving}
                  style={{ cursor: 'pointer' }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 8 }}>
              Available: {formatMoney(balanceFor(currency), currency)} · minimum{' '}
              {formatMoney(MIN_PAYOUT_MINOR[currency], currency)}.
            </div>

            {error ? (
              <div style={{ color: '#ff8178', fontSize: 13, marginTop: 8 }}>{error}</div>
            ) : null}

            <div style={{ marginTop: 12 }}>
              <Button
                variant="primary"
                size="sm"
                disabled={saving}
                onClick={() => void requestPayout()}
              >
                {saving ? 'Submitting…' : 'Request payout'}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Payout request history */}
      <div>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
            marginBottom: 10,
          }}
        >
          Payout requests
        </div>
        {payouts.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>No payout requests yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {payouts.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--gt-border)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span className="gt-numeric">
                      {formatMoney(p.amountMinor, p.currency)}
                    </span>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </div>
                  {p.disbursementRef ? (
                    <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      Ref: {p.disbursementRef}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
                    {DATE_FMT.format(new Date(p.requestedAt))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ledger */}
      <div>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
            marginBottom: 10,
          }}
        >
          Ledger
        </div>
        {entries.length === 0 ? (
          <EmptyState
            title="No entries yet"
            description="Commission credits and payouts will appear here."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--gt-border)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{TYPE_LABEL[entry.type]}</div>
                  {entry.note ? (
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
                      {entry.note}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
                    {DATE_FMT.format(new Date(entry.createdAt))}
                  </div>
                </div>
                <span
                  className="gt-numeric"
                  style={{
                    fontSize: 13,
                    color: entry.amountMinor < 0 ? '#ff8178' : '#4cc264',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.amountMinor < 0 ? '−' : '+'}
                  {formatMoney(Math.abs(entry.amountMinor), entry.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
