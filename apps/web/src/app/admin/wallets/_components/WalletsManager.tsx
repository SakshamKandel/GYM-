'use client';

import { formatMoney } from '@gym/shared';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  TextField,
  TierChip,
} from '@/components/console';

export type CoachTier = 'silver' | 'gold' | 'elite';

export interface WalletBalance {
  currency: string;
  amountMinor: number;
}

export interface WalletRow {
  coachId: string;
  displayName: string;
  email: string;
  coachTier: CoachTier;
  balances: WalletBalance[];
}

export interface LedgerEntry {
  id: string;
  type: 'commission' | 'adjustment' | 'payout';
  amountMinor: number;
  currency: string;
  note: string | null;
  createdAt: string;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const CURRENCIES = ['NPR', 'USD'] as const;

const TYPE_LABEL: Record<LedgerEntry['type'], string> = {
  commission: 'Commission',
  adjustment: 'Adjustment',
  payout: 'Payout',
};

/**
 * Per-coach wallet balances + ledger (SCALE-UP-PLAN §1.3 / §4.1). The ledger
 * is loaded ALL-UP server-side (wallets/page.tsx) and grouped by coach — there
 * is no per-coach ledger-read endpoint in the pinned API surface, only the
 * balances-only GET /api/admin/wallets and the entry-creating POST — so the
 * drawer reads from the already-loaded `ledgerByCoach` prop instead of
 * fetching. Only the "record adjustment/payout" action is a real mutation,
 * hitting POST /api/admin/wallets/[coachId]/entries; on success we
 * router.refresh() so both the balances table and the ledger reflect it.
 */
export function WalletsManager({
  wallets,
  ledgerByCoach,
}: {
  wallets: WalletRow[];
  ledgerByCoach: Record<string, LedgerEntry[]>;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [type, setType] = useState<'adjustment' | 'payout'>('adjustment');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('NPR');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = wallets.find((w) => w.coachId === selectedId) ?? null;

  function openRow(row: WalletRow) {
    setSelectedId(row.coachId);
    setType('adjustment');
    setAmount('');
    setCurrency('NPR');
    setNote('');
    setError(null);
  }

  function close() {
    if (saving) return;
    setSelectedId(null);
  }

  async function recordEntry() {
    if (!selected) return;
    const major = Number(amount);
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    const minor = Math.round(major * 100);
    const signedMinor = type === 'payout' ? -Math.abs(minor) : Math.abs(minor);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/wallets/${encodeURIComponent(selected.coachId)}/entries`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            type,
            amountMinor: signedMinor,
            currency,
            note: note.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to manage wallets.'
            : 'Could not record that entry. Try again.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setAmount('');
      setNote('');
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  const columns: Column<WalletRow>[] = [
    {
      key: 'coach',
      header: 'Coach',
      render: (w) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {w.displayName || w.email}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{w.email}</div>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      width: 90,
      render: (w) => <TierChip tier={w.coachTier} />,
    },
    {
      key: 'balances',
      header: 'Balance',
      align: 'right',
      render: (w) =>
        w.balances.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            {w.balances.map((b) => (
              <span key={b.currency} className="gt-numeric" style={{ fontSize: 13 }}>
                {formatMoney(b.amountMinor, b.currency)}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 100,
      align: 'right',
      render: (w) => (
        <Button variant="ghost" size="sm" onClick={() => openRow(w)}>
          Ledger
        </Button>
      ),
    },
  ];

  return (
    <>
      {wallets.length === 0 ? (
        <EmptyState
          title="No coach wallets yet"
          description="Wallets appear once a coach is approved. Commission credits land automatically when a promo-coded purchase settles."
        />
      ) : (
        <DataTable columns={columns} rows={wallets} rowKey={(w) => w.coachId} />
      )}

      <Drawer
        open={selected != null}
        onClose={close}
        title={selected ? selected.displayName || selected.email : 'Wallet'}
        width={440}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              {selected.email}
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {selected.balances.length === 0 ? (
                <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  No balance yet.
                </span>
              ) : (
                selected.balances.map((b) => (
                  <div
                    key={b.currency}
                    className="gt-card"
                    style={{ padding: '10px 14px' }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>
                      {b.currency}
                    </div>
                    <div className="gt-numeric" style={{ fontSize: 18 }}>
                      {formatMoney(b.amountMinor, b.currency)}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div
              style={{
                padding: 14,
                borderRadius: 10,
                border: '1px solid var(--gt-border)',
              }}
            >
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
                Record entry
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['adjustment', 'payout'] as const).map((t) => {
                  const active = type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      style={{
                        flex: 1,
                        padding: '7px 10px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-heading)',
                        fontSize: 12,
                        fontWeight: 600,
                        background: active ? 'var(--gt-red)' : 'transparent',
                        color: active ? '#fff' : 'var(--gt-text)',
                        border: active
                          ? '1px solid var(--gt-red)'
                          : '1px solid var(--gt-border)',
                      }}
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
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
                  <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                    Currency
                  </span>
                  <select
                    className="gt-input"
                    value={currency}
                    onChange={(e) =>
                      setCurrency(e.target.value as (typeof CURRENCIES)[number])
                    }
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

              <textarea
                className="gt-input"
                placeholder="Note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                disabled={saving}
                style={{ resize: 'vertical', fontFamily: 'inherit', marginTop: 10, width: '100%' }}
              />

              {type === 'payout' ? (
                <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 8 }}>
                  Recorded as a negative ledger entry (money paid out to the coach).
                </div>
              ) : null}

              {error ? (
                <div style={{ color: '#ff8178', fontSize: 13, marginTop: 8 }}>
                  {error}
                </div>
              ) : null}

              <div style={{ marginTop: 12 }}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={saving}
                  onClick={() => void recordEntry()}
                >
                  {saving ? 'Saving…' : `Record ${type}`}
                </Button>
              </div>
            </div>

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
              {(ledgerByCoach[selected.coachId] ?? []).length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  No entries yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(ledgerByCoach[selected.coachId] ?? []).map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 10px',
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
                              maxWidth: 220,
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
        ) : null}
      </Drawer>
    </>
  );
}
