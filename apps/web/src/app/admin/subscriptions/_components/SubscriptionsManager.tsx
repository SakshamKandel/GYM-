'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Modal,
  SearchField,
  StatusChip,
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

/** Shape of one member row from GET /api/admin/members (contract §4.7). */
interface ApiMember {
  id: string;
  email: string;
  displayName: string;
  tier: Tier;
  tierExpiresAt: string | null;
  status: 'active' | 'suspended';
}

function toMemberRow(m: ApiMember): MemberRow {
  return {
    id: m.id,
    email: m.email,
    displayName: m.displayName,
    tier: m.tier,
    status: m.status,
    // The list endpoint doesn't return tierStartedAt (informational only); the
    // modal defaults its start-date input to blank when absent.
    tierStartedAt: null,
    tierExpiresAt: m.tierExpiresAt,
  };
}

/**
 * Members table + tier-override control. The server-rendered roster (capped)
 * is the default view; typing in the search box switches to a SERVER-side
 * keyset search over the WHOLE member base (B8 — members past the roster cap are
 * now reachable), with a "Load more" affordance. A monotonic request-sequence
 * guard drops stale responses so a slow query can't clobber a newer one.
 *
 * "Change tier" opens a modal to pick a new tier, set an optional start date +
 * end date (expiry), and optionally record a reason, then POSTs to
 * /api/admin/subscriptions with credentials:'include'. Submitting with a paid
 * window but a BLANK end date and "No expiry" UNticked is blocked (B10) so a
 * missing date can never silently grant a permanent tier.
 */
export function SubscriptionsManager({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  // null = show the SSR roster; an array = live search results.
  const [remoteRows, setRemoteRows] = useState<MemberRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [nextTier, setNextTier] = useState<Tier>('starter');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [expiresAtLocal, setExpiresAtLocal] = useState('');
  const [noExpiry, setNoExpiry] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(q: string, appendCursor: string | null) {
    const seq = ++reqSeq.current;
    setSearching(true);
    setSearchError(null);
    try {
      const url = new URL('/api/admin/members', window.location.origin);
      if (q) url.searchParams.set('q', q);
      if (appendCursor) url.searchParams.set('cursor', appendCursor);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      if (!res.ok) {
        setSearchError('Could not search members. Try again.');
        setSearching(false);
        return;
      }
      const data = (await res.json()) as { members?: ApiMember[]; nextCursor?: string | null };
      if (seq !== reqSeq.current) return;
      const mapped = (data.members ?? []).map(toMemberRow);
      setRemoteRows((prev) => (appendCursor && prev ? [...prev, ...mapped] : mapped));
      setCursor(data.nextCursor ?? null);
      setSearching(false);
    } catch {
      if (seq === reqSeq.current) {
        setSearchError('Network error while searching.');
        setSearching(false);
      }
    }
  }

  // Debounced server search on the filter text. Empty query → drop back to the
  // SSR roster (no request).
  useEffect(() => {
    const q = filter.trim();
    if (!q) {
      reqSeq.current++; // invalidate any in-flight search
      setRemoteRows(null);
      setCursor(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const t = setTimeout(() => void runSearch(q, null), 250);
    return () => clearTimeout(t);
  }, [filter]);

  const rows = useMemo(() => remoteRows ?? members, [remoteRows, members]);

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
    // B10: a paid window with the expiry field blank AND "No expiry" unticked is
    // ambiguous — it would coerce to a permanent grant. Force an explicit choice.
    if (!noExpiry && !expiresAtLocal) {
      setError('Set an end date, or tick "No expiry (permanent)".');
      return;
    }
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
      // Refresh the SSR roster + stat tiles + recent-changes log.
      router.refresh();
      // When live search results are showing (remoteRows), router.refresh only
      // re-renders the server component's `members` prop, NOT the client-held
      // search rows — the edited member would keep showing its pre-save tier
      // until the next keystroke. Re-run the search so the new tier/expiry is
      // reflected immediately (P1-9 stale-after-save).
      const q = filter.trim();
      if (q) void runSearch(q, null);
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
      render: (m) => <StatusChip status={m.status} />,
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
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>No expiry</span>
          );
        }
        const lapsed = isLapsed(m.tierExpiresAt);
        return (
          <span
            className="gt-numeric"
            style={{
              fontSize: 13,
              color: lapsed ? 'var(--gt-danger)' : 'var(--gt-text)',
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
          placeholder="Search all members by email…"
          aria-label="Search members"
        />
      </div>

      {members.length === 0 && remoteRows === null ? (
        <EmptyState
          title="No members yet"
          description="Members appear here once accounts exist. You can override any member's subscription tier from this table."
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(m) => m.id}
            empty={searching ? 'Searching…' : 'No members match your search.'}
          />
          {searchError ? (
            <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 10 }}>{searchError}</div>
          ) : null}
          {remoteRows !== null && cursor ? (
            <div style={{ marginTop: 12 }}>
              <Button
                variant="ghost"
                disabled={searching}
                onClick={() => void runSearch(filter.trim(), cursor)}
              >
                {searching ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </>
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
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{editing.email}</div>
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
                        background: selected ? 'var(--gt-accent)' : 'transparent',
                        color: selected ? 'var(--gt-accent-ink)' : 'var(--gt-text)',
                        border: selected
                          ? '1px solid var(--gt-accent)'
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
                  style={{ fontFamily: 'inherit', colorScheme: 'light' }}
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
                    colorScheme: 'light',
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
                style={{ accentColor: 'var(--gt-accent)', cursor: 'inherit' }}
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
              <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div>
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
