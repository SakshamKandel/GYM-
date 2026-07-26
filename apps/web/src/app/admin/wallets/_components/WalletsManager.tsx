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
  FilterPill,
  FilterPills,
  SkeletonBar,
  TextField,
  TierChip,
} from '@/components/console';
import { formatDate, formatMoney } from '@/lib/format';
import { MemberLink } from '../../_components/MemberLink';
import { QueueTabs } from '../../_components/QueueTabs';
import { useUrlState } from '../../_components/useUrlState';
import { PartnerWallets, type PartnerWalletRow } from './PartnerWallets';
import { PayoutsQueue } from './PayoutsQueue';

export type { PartnerWalletRow };

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

const CURRENCIES = ['NPR', 'USD'] as const;

const TYPE_LABEL: Record<LedgerEntry['type'], string> = {
  commission: 'Commission',
  adjustment: 'Adjustment',
  payout: 'Payout',
};

/** The top-level views on this page, and what each is called on screen. */
const TAB_LABEL = {
  balances: 'Coaches',
  partners: 'Restaurants',
  payouts: 'Payout requests',
} as const;

type WalletsTab = keyof typeof TAB_LABEL;

/**
 * Per-coach wallet balances + ledger (SCALE-UP-PLAN §1.3 / §4.1). The drawer
 * loads the coach's ledger from GET /api/admin/wallets/[coachId] when it opens
 * (E9) — the old code sliced a global newest-500 feed, so an older coach whose
 * rows fell off the tail showed a nonzero balance next to "No entries yet".
 * Recording an adjustment/payout hits POST /api/admin/wallets/[coachId]/entries;
 * on success we reload the drawer detail and router.refresh() the roster.
 *
 * Restaurant balances sit on their own tab (PartnerWallets) rather than in this
 * table: they are a different rail with a different fold (earned + corrections −
 * payouts, one currency per restaurant), so mixing them into the coach rows
 * would put two different meanings of "balance" in one column.
 */
export function WalletsManager({
  wallets,
  partnerWallets,
  canViewMembers,
  canManageWallets,
  canReviewPayouts,
}: {
  wallets: WalletRow[];
  /** Restaurant balances, shown on their own tab beside the coach ones. */
  partnerWallets: PartnerWalletRow[];
  /** Viewer holds `members.read`, so coach names can link to their record. */
  canViewMembers: boolean;
  /** `wallet.manage` — balances table + record-entry drawer. */
  canManageWallets: boolean;
  /** `payouts.review` — the coach-initiated payout request queue. */
  canReviewPayouts: boolean;
}) {
  const router = useRouter();
  // Which top-level views this operator may see. A payouts.review-only reviewer
  // gets the queue and never the balances tables (P1-5 / C-C).
  const availableTabs: readonly WalletsTab[] = [
    ...(canManageWallets ? (['balances', 'partners'] as const) : []),
    ...(canReviewPayouts ? (['payouts'] as const) : []),
  ];
  // Top-level view: coach balances, restaurant balances (both with a
  // record-entry drawer), or the payout request queue (plan §3 P1-12). Default
  // to the first tab this operator is actually allowed to open.
  // In the URL, so opening a coach's member record from the ledger and coming
  // back returns to the same view. Guarded by what this operator may see: a
  // hand-edited `?view=balances` cannot show a payouts-only reviewer the
  // balances tables, it just falls back to their own first tab.
  const [tab, setTab] = useUrlState<WalletsTab>(
    'view',
    canManageWallets ? 'balances' : 'payouts',
    availableTabs,
  );
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

  // Idempotency key for the current record-entry attempt. Manual ledger rows
  // land with a NULL source, so without this a double-clicked or network-retried
  // payout deducts the coach's balance TWICE. The key is stable across retries
  // of the SAME values and is dropped whenever a money-affecting field changes
  // or the entry succeeds, so a fresh (intended) entry always gets a new key.
  const entryKeyRef = useRef<string | null>(null);
  const resetEntryKey = useCallback(() => {
    entryKeyRef.current = null;
  }, []);

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
            : 'Could not open this wallet. Try again.',
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
      setDetailError('Could not reach us just now. Check your connection and try again.');
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
    resetEntryKey();
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
    // Mint the idempotency key on first attempt and keep it for retries of this
    // same entry; a lost-response retry then records ONE row, not two.
    if (entryKeyRef.current == null) entryKeyRef.current = crypto.randomUUID();
    const idempotencyKey = entryKeyRef.current;
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
          code === 'insufficient_balance'
            ? 'That payout is more than the coach’s current balance.'
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
      // Entry committed — the next one is a distinct row, so retire this key.
      resetEntryKey();
      await loadDetail(selected.coachId);
      router.refresh();
    } catch {
      setError('Could not reach us just now, so nothing was recorded. Try again.');
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
            <MemberLink
              id={w.coachId}
              name={w.displayName}
              email={w.email}
              canView={canViewMembers}
            />
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
      header: 'We owe',
      align: 'right',
      render: (w) =>
        w.balances.length === 0 ? (
          <span className="gt-numeric" style={{ fontSize: 15, color: 'var(--gt-text-faint)' }}>
            —
          </span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            {w.balances.map((b) => (
              <span
                key={b.currency}
                className="gt-numeric"
                style={{ fontSize: 15, color: 'var(--gt-text)' }}
              >
                {formatMoney(b.amountMinor, b.currency)}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 108,
      align: 'right',
      render: (w) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openRow(w)}
          aria-label={`Open the ledger for ${w.displayName || w.email}`}
        >
          Ledger
        </Button>
      ),
    },
  ];

  const drawerBalances = detail?.balances ?? selected?.balances ?? [];
  const drawerEntries = detail?.entries ?? [];

  return (
    <>
      {availableTabs.length > 1 ? (
        <div style={{ marginBottom: 18 }}>
          <QueueTabs
            label="Choose what to look at"
            tabs={availableTabs.map((t) => ({ key: t, label: TAB_LABEL[t] }))}
            value={tab}
            onChange={setTab}
          />
        </div>
      ) : null}

      {tab === 'payouts' ? (
        <PayoutsQueue />
      ) : tab === 'partners' ? (
        <PartnerWallets wallets={partnerWallets} />
      ) : wallets.length === 0 ? (
        <EmptyState
          title="No coach wallets yet"
          description="A wallet opens as soon as a coach is approved. Commission is added on its own whenever someone pays using that coach's promo code."
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
              {selected.revoked ? ' · no longer a coach, but we still owe this balance' : ''}
            </div>

            {/* What we owe leads the panel: it is the figure every entry below
                is about, and the one a payout is checked against. */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {drawerBalances.length === 0 ? (
                <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  Nothing owed yet.
                </span>
              ) : (
                drawerBalances.map((b) => (
                  <div
                    key={b.currency}
                    className="gt-card"
                    style={{ padding: '12px 16px', minWidth: 140 }}
                  >
                    <div
                      style={{
                        fontSize: 'var(--gt-fs-micro)',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--gt-text-dim)',
                        fontFamily: 'var(--font-heading)',
                      }}
                    >
                      We owe
                    </div>
                    <div
                      className="gt-numeric"
                      style={{
                        fontSize: 'var(--gt-fs-h1)',
                        lineHeight: 1.2,
                        color: 'var(--gt-text)',
                      }}
                    >
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
              {selected.revoked ? (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--gt-text-dim)',
                    marginBottom: 10,
                    lineHeight: 1.4,
                  }}
                >
                  This coach’s role was revoked, but their balance is still owed.
                  You can record a final payout here to settle and zero it out.
                </div>
              ) : null}
              {/* Neither of these is the panel's primary action, so neither
                  spends the accent: the kind of entry is a plain choice, and
                  the direction is coloured by what it MEANS — money on or money
                  off — the same way the permission editor's grant/deny does. */}
              <div style={{ marginBottom: 10 }}>
                <FilterPills label="Kind of entry">
                  {(['adjustment', 'payout'] as const).map((t) => (
                    <FilterPill
                      key={t}
                      tone="neutral"
                      selected={type === t}
                      onClick={() => {
                        setType(t);
                        resetEntryKey();
                      }}
                      style={{ flex: 1 }}
                    >
                      {TYPE_LABEL[t]}
                    </FilterPill>
                  ))}
                </FilterPills>
              </div>

              {type === 'adjustment' ? (
                <div style={{ marginBottom: 10 }}>
                  <FilterPills label="Which way the money goes">
                    {(['credit', 'debit'] as const).map((d) => (
                      <FilterPill
                        key={d}
                        tone={d === 'credit' ? 'positive' : 'critical'}
                        selected={direction === d}
                        onClick={() => {
                          setDirection(d);
                          resetEntryKey();
                        }}
                        style={{ flex: 1 }}
                      >
                        {d === 'credit' ? 'Add to balance' : 'Take off balance'}
                      </FilterPill>
                    ))}
                  </FilterPills>
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10 }}>
                <TextField
                  label="Amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    resetEntryKey();
                  }}
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
                    onChange={(e) => {
                      setCurrency(e.target.value as (typeof CURRENCIES)[number]);
                      resetEntryKey();
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

              <textarea
                className="gt-input"
                aria-label="Note about this entry, optional"
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
                {type === 'payout'
                  ? 'Takes this much off the balance. Use it once the money has left our side.'
                  : direction === 'debit'
                    ? 'Takes this much off the balance.'
                    : 'Adds this much to the balance.'}
              </div>

              {error ? (
                <div
                  role="alert"
                  style={{
                    marginTop: 10,
                    border: '1px solid color-mix(in srgb, var(--gt-danger) 38%, transparent)',
                    background: 'var(--gt-danger-weak)',
                    borderRadius: 'var(--gt-radius-sm)',
                    padding: '10px 12px',
                    color: 'var(--gt-text)',
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                >
                  {error}
                </div>
              ) : null}

              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={saving}
                  onClick={() => void recordEntry()}
                >
                  {saving ? 'Saving…' : `Record ${TYPE_LABEL[type].toLowerCase()}`}
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
                <div
                  role="status"
                  aria-label="Loading this coach's entries"
                  style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <SkeletonBar w="60%" />
                  <SkeletonBar w="80%" />
                  <SkeletonBar w="45%" />
                </div>
              ) : detailError ? (
                <div role="alert" style={{ fontSize: 13, color: 'var(--gt-danger)' }}>
                  {detailError}
                </div>
              ) : drawerEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  Nothing has moved on this wallet yet.
                </div>
              ) : (
                // One framed list with hairline rows rather than a stack of
                // separate boxes: money on and money off then read as one column
                // you can run your eye down.
                <div className="gt-card" style={{ padding: 0 }}>
                  {drawerEntries.map((entry, i) => (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        borderBottom:
                          i === drawerEntries.length - 1
                            ? 'none'
                            : '1px solid var(--gt-border)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--gt-text)' }}>
                          {TYPE_LABEL[entry.type]}
                        </div>
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
                        <div style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
                          {formatDate(entry.createdAt)}
                        </div>
                      </div>
                      <span
                        className="gt-numeric"
                        style={{
                          fontSize: 'var(--gt-fs-meta)',
                          color: entry.amountMinor < 0 ? 'var(--gt-danger)' : 'var(--gt-success)',
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
