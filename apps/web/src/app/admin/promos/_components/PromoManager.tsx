'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  EmptyState,
  Modal,
  SearchField,
  TextField,
  Toolbar,
} from '@/components/console';

export interface PromoCodeRow {
  id: string;
  code: string;
  ownerCoachId: string | null;
  ownerLabel: string | null;
  discountPct: number;
  commissionPct: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface CoachOption {
  id: string;
  label: string;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** How many rows are shown before "Load more" reveals another page. The full
 * roster is already server-loaded (page.tsx has no cap today), so this is a
 * client-side slice rather than a network round-trip — it just keeps the
 * initial table short as the coach roster (and its auto-generated codes)
 * grows into the hundreds. */
const PAGE_SIZE = 25;

/** Turns a `date` input value ('' or 'YYYY-MM-DD') into an end-of-day ISO string, or null. */
function fromDateInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Promo code table + creator (SCALE-UP-PLAN §1.3 / §4.1). Every verified
 * coach auto-gets a 30%-off / 30%-commission code (ownerCoachId set); this
 * console additionally lets an admin mint arbitrary "house" codes (any
 * discount 5–90%, no commission owner) or assign a custom code to a specific
 * coach. Mutations hit the guarded /api/admin/promo-codes routes with
 * credentials:'include'; on success we router.refresh() so the table reflects
 * the live redemption counts the server tracks.
 */
export function PromoManager({
  codes,
  coaches,
}: {
  codes: PromoCodeRow[];
  coaches: CoachOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);
  const [ownerMode, setOwnerMode] = useState<'house' | 'coach'>('house');
  const [coachId, setCoachId] = useState('');
  const [code, setCode] = useState('');
  const [discountPct, setDiscountPct] = useState('20');
  const [commissionPct, setCommissionPct] = useState('0');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [toggling, setToggling] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(
    null,
  );

  // Search matches the code itself or the owning coach's display label
  // ("House" for house codes never matches unless typed literally). Purely
  // client-side over the already-loaded roster.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return codes;
    return codes.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        (c.ownerLabel ?? '').toLowerCase().includes(q),
    );
  }, [codes, query]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  function onSearchChange(value: string) {
    setQuery(value);
    setVisibleCount(PAGE_SIZE); // a new search always starts from page 1
  }

  function openCreate() {
    setOwnerMode('house');
    setCoachId('');
    setCode('');
    setDiscountPct('20');
    setCommissionPct('0');
    setMaxRedemptions('');
    setExpiresAt('');
    setError(null);
    setCreateOpen(true);
  }

  async function createCode() {
    const pct = Number(discountPct);
    if (!Number.isInteger(pct) || pct < 5 || pct > 90) {
      setError('Discount must be a whole number between 5 and 90.');
      return;
    }
    const commission = Number(commissionPct || '0');
    if (!Number.isInteger(commission) || commission < 0 || commission > 50) {
      setError('Commission must be a whole number between 0 and 50.');
      return;
    }
    if (ownerMode === 'coach' && !coachId) {
      setError('Pick a coach for a coach-owned code.');
      return;
    }
    const max = maxRedemptions.trim() ? Number(maxRedemptions) : undefined;
    if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
      setError('Max redemptions must be a whole number of 1 or more.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: code.trim() || undefined,
          ownerCoachId: ownerMode === 'coach' ? coachId : undefined,
          discountPct: pct,
          commissionPct: commission,
          maxRedemptions: max,
          expiresAt: fromDateInput(expiresAt) ?? undefined,
        }),
      });
      if (!res.ok) {
        let code2: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code2 = typeof data.error === 'string' ? data.error : null;
        } catch {
          code2 = null;
        }
        setError(
          code2 === 'code_taken'
            ? 'That code is already in use — try another.'
            : res.status === 403
              ? 'You are not allowed to manage promo codes.'
              : 'Could not create that code. Try again.',
        );
        setSaving(false);
        return;
      }
      setSaving(false);
      setCreateOpen(false);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  async function toggleActive(row: PromoCodeRow) {
    setToggling(row.id);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/admin/promo-codes/${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ active: !row.active }),
        },
      );
      if (!res.ok) {
        setRowError({
          id: row.id,
          msg:
            res.status === 403
              ? 'Not allowed.'
              : 'Could not update this code.',
        });
        setToggling(null);
        return;
      }
      setToggling(null);
      router.refresh();
    } catch {
      setRowError({ id: row.id, msg: 'Network error.' });
      setToggling(null);
    }
  }

  const columns: Column<PromoCodeRow>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (r) => (
        <span
          className="gt-numeric"
          style={{ fontSize: 14, letterSpacing: '0.04em' }}
        >
          {r.code}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (r) => (
        <span style={{ fontSize: 13 }}>
          {r.ownerLabel ?? <span style={{ color: 'var(--gt-text-dim)' }}>House</span>}
        </span>
      ),
    },
    {
      key: 'discount',
      header: 'Discount',
      width: 90,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {r.discountPct}%
        </span>
      ),
    },
    {
      key: 'commission',
      header: 'Commission',
      width: 100,
      align: 'right',
      render: (r) => (
        <span
          className="gt-numeric"
          style={{ fontSize: 13, color: r.commissionPct > 0 ? undefined : 'var(--gt-text-dim)' }}
        >
          {r.commissionPct}%
        </span>
      ),
    },
    {
      key: 'redemptions',
      header: 'Redemptions',
      width: 110,
      align: 'right',
      render: (r) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {r.redemptionCount}
          {r.maxRedemptions != null ? ` / ${r.maxRedemptions}` : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (r) => (
        <Badge tone={r.active ? 'positive' : 'neutral'}>
          {r.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'expiry',
      header: 'Expiry',
      width: 110,
      render: (r) =>
        r.expiresAt ? (
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {DATE_FMT.format(new Date(r.expiresAt))}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Never</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 110,
      align: 'right',
      render: (r) => (
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={toggling === r.id}
            onClick={() => void toggleActive(r)}
          >
            {toggling === r.id ? 'Saving…' : r.active ? 'Deactivate' : 'Activate'}
          </Button>
          {rowError?.id === r.id ? (
            <div style={{ color: 'var(--gt-danger)', fontSize: 11, marginTop: 4 }}>
              {rowError.msg}
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <Toolbar
        left={
          <SearchField
            placeholder="Search by code or owner…"
            value={query}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search promo codes"
          />
        }
        right={
          <Button variant="primary" onClick={openCreate}>
            New code
          </Button>
        }
      />

      {codes.length === 0 ? (
        <EmptyState
          title="No promo codes yet"
          description="Coach codes are generated automatically on approval. Create a house code here for one-off promotions."
          action={
            <Button variant="primary" onClick={openCreate}>
              New code
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.id}
            empty="No promo codes match your search."
          />
          {filtered.length > visible.length ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Button
                variant="ghost"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => (saving ? undefined : setCreateOpen(false))}
        title="New promo code"
        width={440}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void createCode()}>
              {saving ? 'Creating…' : 'Create code'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setOwnerMode('house')}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontSize: 13,
                fontWeight: 600,
                background: ownerMode === 'house' ? 'var(--gt-accent)' : 'transparent',
                color: ownerMode === 'house' ? 'var(--gt-accent-ink)' : 'var(--gt-text)',
                border:
                  ownerMode === 'house'
                    ? '1px solid var(--gt-accent)'
                    : '1px solid var(--gt-border)',
              }}
            >
              House code
            </button>
            <button
              type="button"
              onClick={() => setOwnerMode('coach')}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontSize: 13,
                fontWeight: 600,
                background: ownerMode === 'coach' ? 'var(--gt-accent)' : 'transparent',
                color: ownerMode === 'coach' ? 'var(--gt-accent-ink)' : 'var(--gt-text)',
                border:
                  ownerMode === 'coach'
                    ? '1px solid var(--gt-accent)'
                    : '1px solid var(--gt-border)',
              }}
            >
              Coach code
            </button>
          </div>

          {ownerMode === 'coach' ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Coach</span>
              <select
                className="gt-input"
                value={coachId}
                onChange={(e) => setCoachId(e.target.value)}
                disabled={saving}
                style={{ cursor: 'pointer' }}
              >
                <option value="">Select a coach…</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <TextField
            label="Code (optional)"
            placeholder="Auto-generated if left blank"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={saving}
            maxLength={16}
          />

          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Discount %"
              type="number"
              min={5}
              max={90}
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <TextField
              label="Commission %"
              type="number"
              min={0}
              max={50}
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
              disabled={saving}
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <TextField
              label="Max redemptions (optional)"
              type="number"
              min={1}
              placeholder="Unlimited"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <TextField
              label="Expires (optional)"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={saving}
              style={{ flex: 1, colorScheme: 'light' }}
            />
          </div>

          {error ? (
            <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
