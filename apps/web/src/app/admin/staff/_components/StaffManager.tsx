'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Badge,
  Button,
  type Column,
  ConfirmButton,
  DataTable,
  Modal,
  PageHeader,
  SearchField,
  StatusChip,
} from '@/components/console';
import type { StaffRole } from '@/lib/auth';

/**
 * Staff & roles manager (super_admin only). Master table of current staff with
 * per-row role change + revoke, plus a "Grant role" modal that searches EXISTING
 * accounts by email (GET /api/admin/members?q=) and assigns a role. Every
 * mutation hits our own guarded API with credentials:'include' (httpOnly
 * gt_staff cookie authenticates) and then router.refresh()es the server
 * component so the server stays the single source of truth — no optimistic
 * client cache. Mirrors the CoachRoster / ReplyBox pattern already in the app.
 */

export interface StaffMember {
  accountId: string;
  email: string;
  displayName: string;
  status: string;
  role: StaffRole;
  coachName: string | null;
}

// Assignable roles + human labels. Order matches the DB admins.role enum.
const ROLES: { value: StaffRole; label: string }[] = [
  { value: 'super_admin', label: 'Super admin' },
  { value: 'member_admin', label: 'Member admin' },
  { value: 'nutrition_admin', label: 'Nutrition admin' },
  { value: 'content_admin', label: 'Content admin' },
  { value: 'support_admin', label: 'Support admin' },
  { value: 'coach', label: 'Coach' },
];

function roleLabel(role: StaffRole): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

interface MemberHit {
  id: string;
  email: string;
  displayName: string;
  tier: string;
}

const selectStyle: React.CSSProperties = {
  background: 'var(--gt-input-bg, #131416)',
  color: 'var(--gt-text)',
  border: '1px solid var(--gt-border)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'var(--font-heading)',
  cursor: 'pointer',
};

export function StaffManager({
  staff,
  currentAccountId,
}: {
  staff: StaffMember[];
  currentAccountId: string;
}) {
  const router = useRouter();

  // Row-level busy + error state, keyed by accountId, so one row's action never
  // freezes the others.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  // Grant-role modal state.
  const [grantOpen, setGrantOpen] = useState(false);

  function friendlyError(status: number): string {
    if (status === 403) return 'You are not allowed to manage staff roles.';
    if (status === 404) return 'That account no longer exists.';
    if (status === 400) return 'That change is not allowed.';
    return 'Something went wrong. Try again.';
  }

  async function changeRole(accountId: string, role: StaffRole) {
    setBusyId(accountId);
    setRowError(null);
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, role }),
      });
      if (!res.ok) {
        setRowError({ id: accountId, msg: friendlyError(res.status) });
        setBusyId(null);
        return;
      }
      setBusyId(null);
      router.refresh();
    } catch {
      setRowError({ id: accountId, msg: 'Network error.' });
      setBusyId(null);
    }
  }

  async function revoke(accountId: string) {
    setBusyId(accountId);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/admin/staff/${encodeURIComponent(accountId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        setRowError({ id: accountId, msg: friendlyError(res.status) });
        setBusyId(null);
        return;
      }
      setBusyId(null);
      router.refresh();
    } catch {
      setRowError({ id: accountId, msg: 'Network error.' });
      setBusyId(null);
    }
  }

  const columns: Column<StaffMember>[] = [
    {
      key: 'account',
      header: 'Account',
      render: (row) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 220,
              }}
            >
              {row.coachName || row.displayName || row.email}
            </span>
            {row.accountId === currentAccountId ? (
              <Badge tone="info">you</Badge>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--gt-text-dim)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 260,
            }}
          >
            {row.email}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusChip status={row.status === 'suspended' ? 'suspended' : 'active'} />
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: 200,
      render: (row) => {
        const isSelf = row.accountId === currentAccountId;
        const busy = busyId === row.accountId;
        return (
          <select
            value={row.role}
            disabled={busy || isSelf}
            title={isSelf ? 'You cannot change your own role.' : undefined}
            onChange={(e) => changeRole(row.accountId, e.target.value as StaffRole)}
            style={{
              ...selectStyle,
              opacity: busy || isSelf ? 0.55 : 1,
              cursor: busy || isSelf ? 'default' : 'pointer',
            }}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const isSelf = row.accountId === currentAccountId;
        const busy = busyId === row.accountId;
        const err = rowError?.id === row.accountId ? rowError.msg : null;
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
            }}
          >
            {isSelf ? (
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>—</span>
            ) : (
              <ConfirmButton
                label="Revoke"
                confirmLabel="Revoke role?"
                busyLabel="Revoking…"
                busy={busy}
                size="sm"
                onConfirm={() => revoke(row.accountId)}
              />
            )}
            {err ? (
              <span style={{ fontSize: 12, color: '#ff8178', maxWidth: 220 }}>
                {err}
              </span>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 980 }}>
      <PageHeader
        title="Staff & roles"
        subtitle="Grant, change, or revoke staff access. Revoking a role also ends every live session for that account immediately."
        action={
          <Button variant="primary" onClick={() => setGrantOpen(true)}>
            Grant role
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={staff}
        rowKey={(r) => r.accountId}
        empty="No staff yet. Grant a role to an existing account to get started."
      />

      <GrantRoleModal
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        existingIds={new Set(staff.map((s) => s.accountId))}
        onGranted={() => {
          setGrantOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * Grant-role dialog. Searches EXISTING accounts by email substring (GET
 * /api/admin/members?q=), lets the operator pick one and a role, then POSTs to
 * /api/admin/staff. Accounts that are already staff are annotated so it's clear
 * a grant will CHANGE their role rather than add a duplicate. onGranted closes
 * the modal and refreshes.
 */
function GrantRoleModal({
  open,
  onClose,
  existingIds,
  onGranted,
}: {
  open: boolean;
  onClose: () => void;
  existingIds: Set<string>;
  onGranted: () => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MemberHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<MemberHit | null>(null);
  const [role, setRole] = useState<StaffRole>('support_admin');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(term: string) {
    setQ(term);
    setPicked(null);
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/admin/members?q=${encodeURIComponent(trimmed)}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        setHits([]);
        setSearching(false);
        return;
      }
      const data = (await res.json()) as { members?: MemberHit[] };
      setHits(data.members ?? []);
    } catch {
      setHits([]);
    }
    setSearching(false);
  }

  async function submit() {
    if (!picked) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: picked.id, role }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to manage staff roles.'
            : res.status === 404
              ? 'That account no longer exists.'
              : 'Could not grant the role. Try again.',
        );
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      reset();
      onGranted();
    } catch {
      setError('Network error.');
      setSubmitting(false);
    }
  }

  function reset() {
    setQ('');
    setHits([]);
    setPicked(null);
    setRole('support_admin');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Grant a staff role"
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!picked || submitting}
          >
            {submitting ? 'Granting…' : 'Grant role'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div
            style={{
              fontSize: 12,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color: 'var(--gt-text-dim)',
              fontFamily: 'var(--font-heading)',
              marginBottom: 6,
            }}
          >
            Find an account
          </div>
          <SearchField
            value={q}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search by email…"
            autoFocus
          />
        </div>

        {picked ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--gt-red)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
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
                {picked.displayName || picked.email}
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
                {picked.email}
                {existingIds.has(picked.id) ? ' · already staff — role will change' : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="gt-nav-item"
              style={{
                fontSize: 13,
                padding: '4px 10px',
                background: 'none',
                border: '1px solid var(--gt-border)',
                cursor: 'pointer',
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {searching ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', padding: '8px 2px' }}>
                Searching…
              </div>
            ) : q.trim().length < 2 ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', padding: '8px 2px' }}>
                Type at least 2 characters to search.
              </div>
            ) : hits.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', padding: '8px 2px' }}>
                No accounts match “{q.trim()}”.
              </div>
            ) : (
              hits.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPicked(m)}
                  className="gt-card"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '9px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: 'inherit',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        fontFamily: 'var(--font-heading)',
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
                  {existingIds.has(m.id) ? <Badge tone="info">staff</Badge> : null}
                </button>
              ))
            )}
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color: 'var(--gt-text-dim)',
              fontFamily: 'var(--font-heading)',
            }}
          >
            Role
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            style={{ ...selectStyle, width: '100%', padding: '9px 10px', fontSize: 14 }}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {role === 'coach' ? (
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              A coach profile will be created so this account appears in the coach
              roster.
            </span>
          ) : null}
        </label>

        {error ? (
          <div style={{ fontSize: 13, color: '#ff8178' }}>{error}</div>
        ) : null}
      </div>
    </Modal>
  );
}
