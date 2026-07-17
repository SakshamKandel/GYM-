'use client';

import { formatMoney } from '@gym/shared';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
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
  /** True when the account no longer holds the coach role but still has a balance (E10). */
  revoked: boolean;
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

interface WalletDetail {
  balances: WalletBalance[];
  entries: LedgerEntry[];
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
 * Per-coach wallet balances + ledger (SCALE-UP-PLAN §1.3 / §4.1). The drawer
 * loads the coach's ledger from GET /api/admin/wallets/[coachId] when it opens
 * (E9) — the old code sliced a global newest-500 feed, so an older coach whose
 * rows fell off the tail showed a nonzero balance next to "No entries yet".
 * Recording an adjustment/payout hits POST /api/admin/wallets/[coachId]/entries;
 * on success we reload the drawer detail and router.refresh() the roster.
 */
export function WalletsManager({ wallets }: { wallets: WalletRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WalletDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [type, setType] = useState<'adjustment' | 'payout'>('adjustment');
  // For adjustments the admin picks a direction (E8): a credit adds to the
  // balance, a debit (clawback) subtracts. Payouts are always debits.
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('NPR');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic guard so a slow detail fetch for coach A can't overwrite the
  // drawer after the admin has already opened coach B.
  const detailSeq = useRef(0);

  const selected = wallets.find((w) => w.coachId === selectedId) ?? null;

  const loadDetail = useCallback(async (coachId: string) => {
    const seq = ++detailSeq.current;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/wallets/${encodeURIComponent(coachId)}`, {
        credentials: 'include',
      });
      if (seq !== detailSeq.current) return;
      if (!res.ok) {
        setDetailError(
          res.status === 403
            ? 'You are not allowed to view this wallet.'
            : 'Could not load this wallet ledger.',
        );
        setDetailLoading(false);
        return;
      }
      const data = (await res.json()) as WalletDetail;
      if (seq !== detailSeq.current) return;
      setDetail({ balances: data.balances ?? [], entries: data.entries ?? [] });
      setDetailLoading(false);
    } catch {
      if (seq !== detailSeq.current) return;
      setDetailError('Network error.');
      setDetailLoading(false);
    }
  }, []);

  function openRow(row: WalletRow) {
    setSelectedId(row.coachId);
    setType('adjustment');
    setDirection('credit');
    setAmount('');
    setCurrency('NPR');
    setNote('');
    setError(null);
    void loadDetail(row.coachId);
  }

  function close() {
    if (saving) return;
    detailSeq.current++;
    setSelectedId(null);
    setDetail(null);
  }

  async function recordEntry() {
    if (!selected) return;
    const major = Number(amount);
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    const minor = Math.round(major * 100);
    // Sign: payouts and adjustment debits are negative; adjustment credits are
    // positive (E8).
    const negative = type === 'payout' || direction === 'debit';
    const signedMinor = negative ? -Math.abs(minor) : Math.abs(minor);
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
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code = typeof data.error === 'string' ? data.error : null;
        } catch {
          code = null;
        }
        setError(
          code === 'insufficient_balance'
            ? 'That payout is more than the coach’s current balance.'
            : res.status === 403
              ? 'You are not allowed to manage wallets.'
              : 'Could not record that entry. Try again.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setAmount('');
      setNote('');
      await loadDetail(selected.coachId);
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
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {w.displayName || w.email}
            {w.revoked ? <Badge tone="neutral">Revoked</Badge> : null}
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

  const drawerBalances = detail?.balances ?? selected?.balances ?? [];
  const drawerEntries = detail?.entries ?? [];

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
              {selected.revoked ? ' · coach role revoked (balance still owed)' : ''}
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {drawerBalances.length === 0 ? (
                <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  No balance yet.
                </span>
              ) : (
                drawerBalances.map((b) => (
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

              {type === 'adjustment' ? (
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {(['credit', 'debit'] as const).map((d) => {
                    const active = direction === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDirection(d)}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 10,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-heading)',
                          fontSize: 12,
                          fontWeight: 600,
                          background: active ? 'var(--gt-card)' : 'transparent',
                          color: 'var(--gt-text)',
                          border: active
                            ? '1px solid var(--gt-text-dim)'
                            : '1px solid var(--gt-border)',
                        }}
                      >
                        {d === 'credit' ? 'Credit (+)' : 'Debit (−)'}
                      </button>
                    );
                  })}
                </div>
              ) : null}

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

              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 8 }}>
                {type === 'payout'
                  ? 'Recorded as a negative ledger entry (money paid out to the coach).'
                  : direction === 'debit'
                    ? 'Recorded as a negative ledger entry (clawback).'
                    : 'Recorded as a positive ledger entry (credit).'}
              </div>

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
              {detailLoading ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Loading…</div>
              ) : detailError ? (
                <div style={{ fontSize: 13, color: '#ff8178' }}>{detailError}</div>
              ) : drawerEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  No entries yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {drawerEntries.map((entry) => (
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
