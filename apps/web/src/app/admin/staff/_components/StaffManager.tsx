'use client';

import { assignableRolesFor, canManageRole, GRANTABLE_ROLES } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
  TextField,
} from '@/components/console';
import { staffRoleLabel } from '@/app/admin/_lib/staffRoleLabel';
import type { StaffRole } from '@/lib/auth';

/**
 * Staff & roles manager (super_admin + main_admin). Master table of current
 * staff with per-row role change + revoke, plus a "Grant role" modal that
 * searches EXISTING accounts by email (GET /api/admin/members?q=) and assigns a
 * role. Rank-aware: the grantable role list comes from assignableRolesFor
 * (main_admin sees sub-roles only), and rows the caller cannot manage — equal
 * or higher rank per canManageRole, or the caller's own row — render locked
 * with no action controls. The server re-checks every rule (rank, self-target)
 * independently, so the greying here is a courtesy, not the guard. Every
 * mutation hits our own guarded API with credentials:'include' (httpOnly
 * gt_staff cookie authenticates) and then router.refresh()es the server
 * component so the server stays the single source of truth — no optimistic
 * client cache.
 */

export interface StaffMember {
  accountId: string;
  email: string;
  displayName: string;
  status: string;
  role: StaffRole;
  coachName: string | null;
}

interface MemberHit {
  id: string;
  email: string;
  displayName: string;
  tier: string;
  staffRole?: StaffRole | null;
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

/**
 * Reads the API's `{error}` code out of a failed response so rank/self
 * rejections can surface as sentences instead of raw codes. Returns null when
 * the body isn't JSON (or carries no string code).
 */
async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data.error === 'string' ? data.error : null;
  } catch {
    return null;
  }
}

function friendlyStaffError(status: number, code: string | null): string {
  switch (code) {
    case 'insufficient_rank':
      return 'Only a super admin can manage this staff member.';
    case 'cannot_target_self':
    case 'cannot_revoke_self':
      return 'You cannot change your own access.';
    case 'account_not_found':
      return 'That account no longer exists.';
    case 'not_staff':
      return 'That account is no longer staff.';
    case 'invalid_role':
      return 'That role cannot be granted.';
    default:
      break;
  }
  if (status === 403) return 'You are not allowed to manage staff roles.';
  if (status === 404) return 'That account no longer exists.';
  if (status === 400) return 'That change is not allowed.';
  return 'Something went wrong. Try again.';
}

export function StaffManager({
  staff,
  currentAccountId,
  callerRole,
}: {
  staff: StaffMember[];
  currentAccountId: string;
  callerRole: StaffRole;
}) {
  const router = useRouter();

  // Roles this operator may hand out / change rows to. super_admin → all
  // grantable; main_admin → sub-roles only. The deprecated nutrition_admin is
  // filtered out so it can't be granted into a 403 trap (A6); the server
  // enforces the same whitelist.
  const assignable = assignableRolesFor(callerRole).filter((r) =>
    GRANTABLE_ROLES.includes(r),
  );

  // Row-level busy + error state, keyed by accountId, so one row's action never
  // freezes the others.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  // Grant-role modal state.
  const [grantOpen, setGrantOpen] = useState(false);

  // Coach offboarding confirm (P0-3): opened for any action that STRIPS the
  // coach role — a revoke (newRole=null) or a change to a non-coach role — so
  // the operator sees the blast radius and types to confirm. Non-coach rows
  // never route through here.
  const [offboard, setOffboard] = useState<{
    member: StaffMember;
    newRole: StaffRole | null;
  } | null>(null);

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
        const code = await errorCodeOf(res);
        setRowError({ id: accountId, msg: friendlyStaffError(res.status, code) });
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
        const code = await errorCodeOf(res);
        setRowError({ id: accountId, msg: friendlyStaffError(res.status, code) });
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
              <Badge tone="info">You</Badge>
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
        const manageable = !isSelf && canManageRole(callerRole, row.role);
        const busy = busyId === row.accountId;

        // Locked rows (own row, or equal/higher rank) show the role as plain
        // text — a disabled dropdown would suggest a control that exists but is
        // merely off, and this control simply does not exist for the caller.
        if (!manageable) {
          return (
            <span
              title={isSelf ? 'You cannot change your own role.' : undefined}
              style={{
                fontSize: 13,
                fontFamily: 'var(--font-heading)',
                color: 'var(--gt-text-dim)',
              }}
            >
              {staffRoleLabel(row.role)}
            </span>
          );
        }

        // Always include the row's CURRENT role as an option even if it's not
        // in the grantable set (e.g. a legacy nutrition_admin row) so the select
        // shows the real value and the operator can still change it away.
        const options = assignable.includes(row.role)
          ? assignable
          : [row.role, ...assignable];

        return (
          <select
            value={row.role}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value as StaffRole;
              if (next === row.role) return;
              // Changing a coach to a non-coach role strips the coach role and
              // triggers the offboarding cascade server-side — confirm first.
              if (row.role === 'coach' && next !== 'coach') {
                setOffboard({ member: row, newRole: next });
              } else {
                void changeRole(row.accountId, next);
              }
            }}
            style={{
              ...selectStyle,
              opacity: busy ? 0.55 : 1,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {options.map((r) => (
              <option key={r} value={r}>
                {staffRoleLabel(r)}
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
        const manageable = !isSelf && canManageRole(callerRole, row.role);
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
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>You</span>
            ) : !manageable ? (
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                Managed by super admin
              </span>
            ) : row.role === 'coach' ? (
              // Revoking a coach ends assignments/plans — go through the
              // offboarding confirm (P0-3) rather than a one-tap revoke.
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => setOffboard({ member: row, newRole: null })}
              >
                Revoke…
              </Button>
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
        callerRole={callerRole}
        currentAccountId={currentAccountId}
        assignable={assignable}
        onGranted={() => {
          setGrantOpen(false);
          router.refresh();
        }}
      />

      <OffboardModal
        target={offboard}
        onClose={() => setOffboard(null)}
        onDone={() => {
          setOffboard(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/** Outstanding balance per currency, plus the counts of what a revoke ends. */
interface OffboardCounts {
  activeClients: number;
  pendingRequests: number;
  activeWorkoutPlans: number;
  activeDietPlans: number;
  walletBalances: { currency: string; amountMinor: number }[];
}

/** Formats a minor-unit balance line ("NPR 12,300 · USD 45"). */
function formatBalances(rows: { currency: string; amountMinor: number }[]): string {
  return rows
    .map((r) => `${r.currency} ${Math.round(r.amountMinor / 100).toLocaleString()}`)
    .join(' · ');
}

/**
 * Coach offboarding confirm dialog (P0-3). On open it runs the server's
 * READ-ONLY dry-run (DELETE ?dryRun=1) to fetch the real blast radius, shows
 * it, and — when clients are attached or money is outstanding — requires the
 * operator to type CONFIRM before the destructive action fires. A non-zero
 * wallet balance is WARNED, not blocked (money history is preserved either way).
 * Handles both a plain revoke (newRole null → DELETE) and a change to a
 * non-coach role (newRole set → POST), since both strip the coach role.
 */
function OffboardModal({
  target,
  onClose,
  onDone,
}: {
  target: { member: StaffMember; newRole: StaffRole | null } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const open = target != null;
  const member = target?.member ?? null;
  const newRole = target?.newRole ?? null;

  const [counts, setCounts] = useState<OffboardCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountId = member?.accountId ?? null;

  const loadCounts = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/staff/${encodeURIComponent(id)}?dryRun=1`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const code = await errorCodeOf(res);
        setError(friendlyStaffError(res.status, code));
        setCounts(null);
        return;
      }
      const data = (await res.json()) as { counts: OffboardCounts | null };
      setCounts(data.counts);
    } catch {
      setError('Network error.');
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset + (re)load the dry-run whenever a new target is opened.
  useEffect(() => {
    if (!accountId) return;
    setCounts(null);
    setConfirmText('');
    setError(null);
    void loadCounts(accountId);
  }, [accountId, loadCounts]);

  const hasImpact =
    counts != null &&
    (counts.activeClients > 0 ||
      counts.pendingRequests > 0 ||
      counts.activeWorkoutPlans > 0 ||
      counts.activeDietPlans > 0 ||
      counts.walletBalances.length > 0);
  // Require a typed confirm only when there's real impact; a clean coach (no
  // clients/plans/money) can be offboarded with a single click.
  const needsType = hasImpact;
  const confirmOk = !needsType || confirmText.trim().toUpperCase() === 'CONFIRM';

  async function run() {
    if (!member || !confirmOk) return;
    setSubmitting(true);
    setError(null);
    try {
      const res =
        newRole == null
          ? await fetch(`/api/admin/staff/${encodeURIComponent(member.accountId)}`, {
              method: 'DELETE',
              credentials: 'include',
            })
          : await fetch('/api/admin/staff', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId: member.accountId, role: newRole }),
            });
      if (!res.ok) {
        const code = await errorCodeOf(res);
        setError(friendlyStaffError(res.status, code));
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      onDone();
    } catch {
      setError('Network error.');
      setSubmitting(false);
    }
  }

  const title =
    newRole == null
      ? 'Revoke coach access'
      : `Change coach to ${staffRoleLabel(newRole)}`;
  const actionLabel = newRole == null ? 'Revoke access' : 'Change role';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={run}
            disabled={submitting || loading || !confirmOk}
          >
            {submitting ? 'Working…' : actionLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 14, color: 'var(--gt-text)', margin: 0 }}>
          {member?.coachName || member?.displayName || member?.email}
        </p>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Checking what this affects…
          </div>
        ) : counts ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--gt-border)',
              fontSize: 13,
            }}
          >
            <div style={{ color: 'var(--gt-text-dim)' }}>
              Offboarding this coach will:
            </div>
            <CountLine n={counts.activeClients} label="active client assignment" verb="end" />
            <CountLine
              n={counts.pendingRequests}
              label="pending client request"
              verb="decline"
            />
            <CountLine
              n={counts.activeWorkoutPlans}
              label="assigned workout plan"
              verb="archive"
            />
            <CountLine n={counts.activeDietPlans} label="assigned diet plan" verb="archive" />
            {counts.walletBalances.length > 0 ? (
              <div style={{ color: '#e0b341', marginTop: 4 }}>
                ⚠ Outstanding wallet balance: {formatBalances(counts.walletBalances)} — settle
                payouts before revoking (the ledger is preserved either way).
              </div>
            ) : null}
          </div>
        ) : null}

        {needsType ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              Type <strong style={{ color: 'var(--gt-text)' }}>CONFIRM</strong> to proceed.
            </span>
            <TextField
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="CONFIRM"
              aria-label="Type CONFIRM to proceed"
              autoFocus
            />
          </div>
        ) : null}

        {error ? <div style={{ fontSize: 13, color: '#ff8178' }}>{error}</div> : null}
      </div>
    </Modal>
  );
}

/** One "will end 3 active client assignments" line; renders nothing when n=0. */
function CountLine({ n, label, verb }: { n: number; label: string; verb: string }) {
  if (n <= 0) return null;
  return (
    <div style={{ color: 'var(--gt-text)' }}>
      {verb} <strong>{n}</strong> {label}
      {n === 1 ? '' : 's'}
    </div>
  );
}

/**
 * Grant-role dialog. Searches EXISTING accounts by email substring (GET
 * /api/admin/members?q=), lets the operator pick one and a role, then POSTs to
 * /api/admin/staff. The role list is the caller's assignable set, and picks the
 * caller cannot act on — their own account, or an account already holding a
 * role they cannot manage — disable Grant with a plain-language reason instead
 * of letting the server bounce them. onGranted closes the modal and refreshes.
 */
function GrantRoleModal({
  open,
  onClose,
  callerRole,
  currentAccountId,
  assignable,
  onGranted,
}: {
  open: boolean;
  onClose: () => void;
  callerRole: StaffRole;
  currentAccountId: string;
  assignable: StaffRole[];
  onGranted: () => void;
}) {
  // support_admin is the least-privileged default; every role that may open
  // this page can grant it, but fall back defensively to the last (lowest-rank)
  // assignable entry.
  const defaultRole: StaffRole = assignable.includes('support_admin')
    ? 'support_admin'
    : (assignable[assignable.length - 1] ?? 'support_admin');

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MemberHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<MemberHit | null>(null);
  const [role, setRole] = useState<StaffRole>(defaultRole);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickedRole = picked?.staffRole ?? null;
  const pickedIsSelf = picked != null && picked.id === currentAccountId;
  // Already staff at a rank the caller cannot manage → the server would reject
  // the grant with insufficient_rank, so say why up front and disable Grant.
  const pickedLocked =
    pickedRole != null && !canManageRole(callerRole, pickedRole);

  // Typing only updates the query + clears any prior pick; the network search
  // itself is debounced and ordering-guarded by the effect below.
  function onQueryChange(term: string) {
    setQ(term);
    setPicked(null);
  }

  // Debounce (~250ms) so a burst of keystrokes issues one request, and abort the
  // in-flight request whenever the term changes so a slow "jo" response can never
  // land after — and overwrite — the newer "john" results (stale-result guard).
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/admin/members?q=${encodeURIComponent(trimmed)}`,
            { credentials: 'include', signal: controller.signal },
          );
          if (!res.ok) {
            setHits([]);
            setSearching(false);
            return;
          }
          const data = (await res.json()) as { members?: MemberHit[] };
          setHits(data.members ?? []);
          setSearching(false);
        } catch {
          // Aborted calls are superseded by a newer term — leave state to the
          // newer effect run and don't clobber it here.
          if (controller.signal.aborted) return;
          setHits([]);
          setSearching(false);
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  async function submit() {
    if (!picked || pickedIsSelf || pickedLocked) return;
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
        const code = await errorCodeOf(res);
        setError(friendlyStaffError(res.status, code));
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
    setRole(defaultRole);
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
            disabled={!picked || pickedIsSelf || pickedLocked || submitting}
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
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by email…"
            autoFocus
          />
        </div>

        {picked ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--gt-red)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  {pickedRole != null && !pickedIsSelf && !pickedLocked
                    ? ` · already ${staffRoleLabel(pickedRole)} — role will change`
                    : ''}
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
            {pickedIsSelf ? (
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                This is your own account — you cannot change your own role.
              </div>
            ) : pickedLocked ? (
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                Managed by super admin — you cannot change this account’s role.
              </div>
            ) : null}
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
                  {m.staffRole != null ? (
                    <Badge tone="info">{staffRoleLabel(m.staffRole)}</Badge>
                  ) : null}
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
            {assignable.map((r) => (
              <option key={r} value={r}>
                {staffRoleLabel(r)}
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
