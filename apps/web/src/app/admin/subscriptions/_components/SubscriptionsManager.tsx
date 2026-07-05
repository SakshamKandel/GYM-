'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Modal,
  SearchField,
  TierChip,
} from '@/components/console';

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

export interface MemberRow {
  id: string;
  email: string;
  displayName: string;
  tier: Tier;
  status: 'active' | 'suspended';
  /** ISO string when the current tier took effect, or null. Informational. */
  tierStartedAt: string | null;
  /** ISO string when the tier lapses, or null = permanent / no expiry. */
  tierExpiresAt: string | null;
}

const TIERS: readonly Tier[] = ['starter', 'silver', 'gold', 'elite'];

/** Short, locale-stable date label for the expiry column + modal summary. */
const DATE_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Formats an ISO timestamp for a `datetime-local` input value (local time,
 * `YYYY-MM-DDTHH:mm`). Returns '' for null/empty so the field renders blank.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Shift to local time then trim to minutes for the input's format.
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** Turns a `datetime-local` value back into a full ISO string (UTC). '' → null. */
function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Whether an ISO expiry is in the past (member is currently lapsed). */
function isLapsed(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/**
 * Members table + tier-override control. Filtering is client-side over the
 * server-rendered roster (the page already caps the roster). The table shows
 * each member's current tier AND its expiry (a permanent tier reads "No
 * expiry"; a past expiry reads "Lapsed"). "Change tier" opens a modal to pick a
 * new tier, set an optional start date + end date (expiry), and optionally
 * record a reason, then POSTs to /api/admin/subscriptions with
 * credentials:'include' so the httpOnly gt_staff cookie authenticates it.
 *
 * Date semantics match the endpoint: an empty end date with "No expiry
 * (permanent)" checked sends expiresAt=null (clears any expiry); an end date in
 * the past lapses the tier immediately. The start date is informational
 * (audit/history). Omitted-vs-cleared is made explicit in the UI so a save is
 * always predictable — we always send both date fields based on the controls.
 * On success we router.refresh() so the roster + change log reflect the
 * override without a full reload.
 */
export function SubscriptionsManager({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [nextTier, setNextTier] = useState<Tier>('starter');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [expiresAtLocal, setExpiresAtLocal] = useState('');
  const [noExpiry, setNoExpiry] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q),
    );
  }, [members, filter]);

  function openEdit(m: MemberRow) {
    setEditing(m);
    setNextTier(m.tier);
    setStartsAtLocal(toLocalInput(m.tierStartedAt));
    setExpiresAtLocal(toLocalInput(m.tierExpiresAt));
    // Default the "no expiry" toggle to the member's current state: permanent
    // when they have no expiry set, dated when they do.
    setNoExpiry(m.tierExpiresAt === null);
    setReason('');
    setError(null);
  }

  function closeEdit() {
    if (saving) return;
    setEditing(null);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    // Build the dated window from the controls. We always send both date fields
    // so a save is unambiguous: startsAt from its input (null when blank),
    // expiresAt is null when "No expiry" is on, else the picked end date.
    const startsAt = fromLocalInput(startsAtLocal);
    const expiresAt = noExpiry ? null : fromLocalInput(expiresAtLocal);
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountId: editing.id,
          tier: nextTier,
          reason: reason.trim() || undefined,
          startsAt,
          expiresAt,
        }),
      });
      if (!res.ok) {
        let msg = 'Could not update this tier. Try again.';
        if (res.status === 403) msg = 'You are not allowed to override tiers.';
        else if (res.status === 404) msg = 'That member no longer exists.';
        else if (res.status === 400) msg = 'Please check the dates and try again.';
        setError(msg);
        setSaving(false);
        return;
      }
      setSaving(false);
      setEditing(null);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  const columns: Column<MemberRow>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (m) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.displayName || m.email}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--gt-text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.email}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Account',
      render: (m) => (
        <span
          style={{
            fontSize: 12,
            color:
              m.status === 'suspended' ? '#ff8178' : 'var(--gt-text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontFamily: 'var(--font-numeric)',
          }}
        >
          {m.status}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Current tier',
      render: (m) => <TierChip tier={m.tier} />,
    },
    {
      key: 'expiry',
      header: 'Expiry',
      render: (m) => {
        // Starter never expires; a null expiry on any paid tier = permanent.
        if (m.tier === 'starter' || m.tierExpiresAt === null) {
          return (
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              No expiry
            </span>
          );
        }
        const lapsed = isLapsed(m.tierExpiresAt);
        return (
          <span
            className="gt-numeric"
            style={{
              fontSize: 13,
              color: lapsed ? '#ff8178' : 'var(--gt-text)',
              whiteSpace: 'nowrap',
            }}
            title={new Date(m.tierExpiresAt).toLocaleString()}
          >
            {lapsed ? 'Lapsed · ' : ''}
            {DATE_LABEL.format(new Date(m.tierExpiresAt))}
          </span>
        );
      },
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (m) => (
        <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
          Change tier
        </Button>
      ),
    },
  ];

  return (
    <>
      <div style={{ maxWidth: 320, marginBottom: 14 }}>
        <SearchField
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or email…"
          aria-label="Filter members"
        />
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Members appear here once accounts exist. You can override any member's subscription tier from this table."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          empty="No members match your filter."
        />
      )}

      <Modal
        open={editing !== null}
        onClose={closeEdit}
        title="Override subscription tier"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={closeEdit} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Apply override'}
            </Button>
          </>
        }
      >
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {editing.displayName || editing.email}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                {editing.email}
              </div>
            </div>

            <div>
              <FieldLabel>New tier</FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TIERS.map((t) => {
                  const selected = nextTier === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNextTier(t)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-numeric)',
                        fontSize: 13,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        background: selected ? 'var(--gt-red)' : 'transparent',
                        color: selected ? '#fff' : 'var(--gt-text)',
                        border: selected
                          ? '1px solid var(--gt-red)'
                          : '1px solid var(--gt-border)',
                        transition: 'background 120ms, border-color 120ms',
                      }}
                    >
                      {t}
                      {t === editing.tier ? ' (current)' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: '1 1 180px',
                }}
              >
                <FieldLabel as="span">Start date (optional)</FieldLabel>
                <input
                  type="datetime-local"
                  className="gt-input"
                  value={startsAtLocal}
                  onChange={(e) => setStartsAtLocal(e.target.value)}
                  disabled={saving}
                  style={{ fontFamily: 'inherit', colorScheme: 'dark' }}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: '1 1 180px',
                }}
              >
                <FieldLabel as="span">End date (expiry)</FieldLabel>
                <input
                  type="datetime-local"
                  className="gt-input"
                  value={expiresAtLocal}
                  onChange={(e) => {
                    setExpiresAtLocal(e.target.value);
                    if (e.target.value) setNoExpiry(false);
                  }}
                  disabled={saving || noExpiry}
                  style={{
                    fontFamily: 'inherit',
                    colorScheme: 'dark',
                    opacity: noExpiry ? 0.5 : 1,
                  }}
                />
              </label>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: 'var(--gt-text)',
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={noExpiry}
                disabled={saving}
                onChange={(e) => {
                  setNoExpiry(e.target.checked);
                  if (e.target.checked) setExpiresAtLocal('');
                }}
                style={{ accentColor: 'var(--gt-red)', cursor: 'inherit' }}
              />
              No expiry (permanent)
            </label>

            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--gt-text-dim)',
                lineHeight: 1.5,
              }}
            >
              {noExpiry
                ? 'This tier will never lapse. Any existing expiry is cleared.'
                : expiresAtLocal
                  ? isLapsed(fromLocalInput(expiresAtLocal))
                    ? 'This end date is in the past — the tier lapses immediately (the member signs in as starter).'
                    : `Tier lapses on ${DATE_LABEL.format(new Date(fromLocalInput(expiresAtLocal) as string))}. Elite auto-assign only applies while the tier is active.`
                  : 'Set an end date, or tick "No expiry" for a permanent tier.'}
            </p>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <FieldLabel as="span">Reason (optional)</FieldLabel>
              <textarea
                className="gt-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. comped for support escalation"
                rows={3}
                maxLength={500}
                disabled={saving}
                style={{ resize: 'vertical', fontFamily: 'inherit' }}
              />
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                Recorded in the audit log alongside this override.
              </span>
            </label>

            {error ? (
              <div style={{ color: 'var(--gt-red)', fontSize: 13 }}>{error}</div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/** The small uppercase caption used above each control in the modal. */
function FieldLabel({
  children,
  as = 'div',
}: {
  children: ReactNode;
  as?: 'div' | 'span';
}) {
  const Tag = as;
  return (
    <Tag
      style={{
        display: 'block',
        fontSize: 12,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: 'var(--gt-text-dim)',
        fontFamily: 'var(--font-heading)',
        marginBottom: as === 'div' ? 8 : 0,
      }}
    >
      {children}
    </Tag>
  );
}
