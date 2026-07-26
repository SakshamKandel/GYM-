'use client';

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
} from '@/components/console';
import { formatDate, formatMoney, parseMoneyInput } from '@/lib/format';

/** One restaurant plus what we still hold for it, in its own currency. */
export interface PartnerWalletRow {
  partnerId: string;
  name: string;
  currency: string;
  isActive: boolean;
  /** Earned so far, plus corrections, less what has already been paid out. */
  heldMinor: number;
}

/** One movement on a restaurant's wallet. */
interface PartnerLedgerEntry {
  id: string;
  type: 'earning' | 'adjustment' | 'payout';
  amountMinor: number;
  currency: string;
  sourceType: string | null;
  note: string | null;
  createdAt: string;
}

interface PartnerWalletDetail {
  partnerId: string;
  name: string;
  currency: string;
  earnedMinor: number;
  adjustmentMinor: number;
  paidOutMinor: number;
  heldMinor: number;
  entries: PartnerLedgerEntry[];
}

const TYPE_LABEL: Record<PartnerLedgerEntry['type'], string> = {
  earning: 'Earned',
  adjustment: 'Correction',
  payout: 'Paid out',
};

/**
 * How a row moves the balance. The fold is earned + corrections − paid out, so a
 * payout is STORED positive but takes money off. Showing it as a plus would read
 * as the restaurant being owed more every time we paid it.
 */
function balanceEffect(entry: PartnerLedgerEntry): number {
  return entry.type === 'payout' ? -entry.amountMinor : entry.amountMinor;
}

/**
 * Restaurant wallets, beside the coach ones. Balances are read on the server;
 * opening a row loads that restaurant's movements from
 * GET /api/admin/partners/[id]/ledger and offers the one lever this rail was
 * missing: a manual correction, either direction.
 *
 * Deliberately NOT here: earnings and payouts. What a restaurant has earned is
 * derived from its delivered orders, and payouts are posted by the payout queue
 * when a request is approved. A correction is the only entry an operator writes
 * by hand, which is exactly how the coach rail works.
 */
export function PartnerWallets({ wallets }: { wallets: PartnerWalletRow[] }) {
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnerWalletDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic guard so a slow load for restaurant A can't land in the drawer
  // after the operator has already opened restaurant B.
  const detailSeq = useRef(0);

  // Idempotency key for the current correction. Manual rows land with no source
  // of their own, so without this a double-click or a retried request would move
  // the balance twice. The key survives retries of the SAME values and is retired
  // whenever the amount changes or the entry lands.
  const entryKeyRef = useRef<string | null>(null);
  const resetEntryKey = useCallback(() => {
    entryKeyRef.current = null;
  }, []);

  const selected = wallets.find((w) => w.partnerId === selectedId) ?? null;

  const loadDetail = useCallback(async (partnerId: string) => {
    const seq = ++detailSeq.current;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/partners/${encodeURIComponent(partnerId)}/ledger`, {
        credentials: 'include',
      });
      if (seq !== detailSeq.current) return;
      if (!res.ok) {
        setDetailError(
          res.status === 403
            ? 'You are not allowed to view this wallet.'
            : 'Could not open this wallet. Try again.',
        );
        setDetailLoading(false);
        return;
      }
      const data = (await res.json()) as PartnerWalletDetail;
      if (seq !== detailSeq.current) return;
      setDetail({ ...data, entries: data.entries ?? [] });
      setDetailLoading(false);
    } catch {
      if (seq !== detailSeq.current) return;
      setDetailError('Could not reach us just now. Check your connection and try again.');
      setDetailLoading(false);
    }
  }, []);

  function openRow(row: PartnerWalletRow) {
    setSelectedId(row.partnerId);
    setDirection('credit');
    setAmount('');
    setNote('');
    setError(null);
    resetEntryKey();
    void loadDetail(row.partnerId);
  }

  function close() {
    if (saving) return;
    detailSeq.current++;
    setSelectedId(null);
    setDetail(null);
  }

  async function recordAdjustment() {
    if (!selected) return;
    const minor = parseMoneyInput(amount);
    if (minor === null || minor <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    const signedMinor = direction === 'debit' ? -minor : minor;
    if (entryKeyRef.current == null) entryKeyRef.current = crypto.randomUUID();
    const idempotencyKey = entryKeyRef.current;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/partners/${encodeURIComponent(selected.partnerId)}/ledger`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            type: 'adjustment',
            amountMinor: signedMinor,
            currency: selected.currency,
            note: note.trim() || undefined,
            idempotencyKey,
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
          code === 'currency_mismatch'
            ? `This restaurant is paid in ${selected.currency}. Reopen the wallet and try again.`
            : code === 'not_found'
              ? 'That restaurant no longer exists.'
              : res.status === 403
                ? 'You are not allowed to manage wallets.'
                : 'Nothing was recorded. Try again.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setAmount('');
      setNote('');
      // Entry committed — the next one is its own row, so retire this key.
      resetEntryKey();
      await loadDetail(selected.partnerId);
      router.refresh();
    } catch {
      setError('Could not reach us just now, so nothing was recorded. Try again.');
      setSaving(false);
    }
  }

  const columns: Column<PartnerWalletRow>[] = [
    {
      key: 'partner',
      header: 'Restaurant',
      render: (w) => (
        <div
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 260,
            }}
          >
            {w.name}
          </span>
          {w.isActive ? null : <Badge tone="neutral">Closed</Badge>}
        </div>
      ),
    },
    {
      key: 'currency',
      header: 'Currency',
      width: 90,
      render: (w) => w.currency,
    },
    {
      key: 'held',
      header: 'We hold',
      align: 'right',
      render: (w) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {formatMoney(w.heldMinor, w.currency)}
        </span>
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
          title="No restaurant wallets yet"
          description="A wallet opens with the restaurant. It fills up as delivered orders are paid for online."
        />
      ) : (
        <DataTable columns={columns} rows={wallets} rowKey={(w) => w.partnerId} />
      )}

      <Drawer
        open={selected != null}
        onClose={close}
        title={selected ? selected.name : 'Wallet'}
        width={440}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <MoneyTile
                label="We hold"
                amountMinor={detail?.heldMinor ?? selected.heldMinor}
                currency={selected.currency}
                strong
              />
              {detail ? (
                <>
                  <MoneyTile
                    label="Earned"
                    amountMinor={detail.earnedMinor}
                    currency={detail.currency}
                  />
                  <MoneyTile
                    label="Paid out"
                    amountMinor={detail.paidOutMinor}
                    currency={detail.currency}
                  />
                  <MoneyTile
                    label="Corrections"
                    amountMinor={detail.adjustmentMinor}
                    currency={detail.currency}
                  />
                </>
              ) : null}
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
                Record a correction
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['credit', 'debit'] as const).map((d) => {
                  const active = direction === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDirection(d);
                        resetEntryKey();
                      }}
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

              <TextField
                label={`Amount in ${selected.currency}`}
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  resetEntryKey();
                }}
                disabled={saving}
              />

              <textarea
                className="gt-input"
                placeholder="Note (optional)"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  resetEntryKey();
                }}
                rows={2}
                maxLength={500}
                disabled={saving}
                style={{ resize: 'vertical', fontFamily: 'inherit', marginTop: 10, width: '100%' }}
              />

              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 8 }}>
                {direction === 'debit'
                  ? 'Takes this much off what we hold for this restaurant.'
                  : 'Adds this much to what we hold for this restaurant.'}{' '}
                Earnings and payouts are recorded on their own, so use this only
                to put a balance right.
              </div>

              {error ? (
                <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 8 }}>{error}</div>
              ) : null}

              <div style={{ marginTop: 12 }}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={saving}
                  onClick={() => void recordAdjustment()}
                >
                  {saving ? 'Saving…' : 'Record correction'}
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
                <div style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{detailError}</div>
              ) : (detail?.entries.length ?? 0) === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>No entries yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {detail?.entries.map((entry) => {
                    const effect = balanceEffect(entry);
                    return (
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
                            {formatDate(entry.createdAt)}
                          </div>
                        </div>
                        <span
                          className="gt-numeric"
                          style={{
                            fontSize: 13,
                            color: effect < 0 ? 'var(--gt-danger)' : 'var(--gt-success)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {effect < 0 ? '−' : '+'}
                          {formatMoney(Math.abs(effect), entry.currency)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

/** One money figure in the drawer header. */
function MoneyTile({
  label,
  amountMinor,
  currency,
  strong = false,
}: {
  label: string;
  amountMinor: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div className="gt-card" style={{ padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--gt-text-dim)' }}>{label}</div>
      <div className="gt-numeric" style={{ fontSize: strong ? 18 : 15 }}>
        {formatMoney(amountMinor, currency)}
      </div>
    </div>
  );
}
