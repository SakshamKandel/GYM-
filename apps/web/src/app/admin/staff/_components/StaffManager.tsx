'use client';

import {
  ALL_PERMISSIONS,
  assignableRolesFor,
  canManageRole,
  GRANTABLE_ROLES,
  type Permission,
} from '@gym/shared';
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
  background: 'var(--gt-surface)',
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
    case 'invalid_permission':
      return 'That permission is not recognised.';
    case 'cannot_modify_super_admin':
      return 'A super admin’s permissions cannot be overridden.';
    case 'partner_override_forbidden':
      return 'A partner account may only ever hold its two delivery permissions.';
    default:
      break;
  }
  if (status === 403) return 'You are not allowed to manage staff roles.';
  if (status === 404) return 'That account no longer exists.';
  if (status === 400) return 'That change is not allowed.';
  return 'Something went wrong. Try again.';
}

/**
 * Human copy for each permission key, keyed by the exact @gym/shared literal.
 * Display only — the effective/override truth comes from the server payload.
 * Any key without an entry falls back to the raw key so a newly added
 * permission still renders (and this map is exhaustively covered by a
 * `satisfies Record<Permission, …>`, so a new key breaks the type until copy is
 * supplied).
 */
const PERMISSION_META = {
  'members.read': { label: 'Read members', desc: 'View the member directory.' },
  'members.suspend': {
    label: 'Suspend members',
    desc: 'Suspend or reactivate member accounts.',
  },
  'coach.assign': { label: 'Assign coaches', desc: 'Assign a coach to a member.' },
  'subscription.override': {
    label: 'Override subscription',
    desc: 'Change a member’s subscription tier.',
  },
  'audit.read': { label: 'Read audit log', desc: 'View the admin audit trail.' },
  'roles.grant': {
    label: 'Manage staff roles',
    desc: 'Grant, change, or revoke staff roles.',
  },
  'support.thread.read': {
    label: 'Read support threads',
    desc: 'List and read member support tickets.',
  },
  'support.thread.reply': {
    label: 'Reply to support',
    desc: 'Reply into a support thread.',
  },
  'coach.application.review': {
    label: 'Review coach applications',
    desc: 'Approve/reject applications and tier requests.',
  },
  'payments.review': {
    label: 'Review payments',
    desc: 'Approve, reject, or refund payment requests.',
  },
  'promo.manage': { label: 'Manage promo codes', desc: 'Create and toggle promo codes.' },
  'pricing.manage': { label: 'Manage pricing', desc: 'Edit regional tier prices.' },
  'wallet.manage': {
    label: 'Manage wallets',
    desc: 'View wallets, record adjustments and payouts.',
  },
  'content.manage': {
    label: 'Manage content',
    desc: 'Org-wide plan-video CRUD (any row).',
  },
  'content.video.own': {
    label: 'Manage own videos',
    desc: 'CRUD only videos this coach created.',
  },
  'coach.message.user': {
    label: 'Message clients',
    desc: 'Reply into an assigned client’s thread.',
  },
  'coach.user.read': {
    label: 'Read clients',
    desc: 'Read assigned clients’ threads and profile.',
  },
  'coach.wallet.read': {
    label: 'Read own wallet',
    desc: 'A coach reading their own wallet balance.',
  },
  'client.tier_grant': {
    label: 'Grant client tiers',
    desc: 'Coach-initiated client tier grants (off by default).',
  },
  'broadcast.send': {
    label: 'Send broadcasts',
    desc: 'Send announcements and push broadcasts.',
  },
  'members.manage_credentials': {
    label: 'Manage credentials',
    desc: 'Password reset, force sign-out, identity fixes.',
  },
  'payouts.review': {
    label: 'Review payouts',
    desc: 'Approve, reject, or mark coach payouts paid.',
  },
  'analytics.read': {
    label: 'Read analytics',
    desc: 'View revenue, churn, and coach-performance analytics.',
  },
  'permissions.override': {
    label: 'Manage permissions',
    desc: 'Grant or strip per-account permission overrides.',
  },
  'moderation.manage': {
    label: 'Moderate content',
    desc: 'Custom foods, progress photos, milestones.',
  },
  'catalog.manage': {
    label: 'Manage catalog',
    desc: 'CRUD the exercises and plans catalog.',
  },
  'gamification.manage': {
    label: 'Manage gamification',
    desc: 'XP corrections, badge audit/revoke, challenge moderation.',
  },
  'meals.own': {
    label: 'Manage own meals',
    desc: 'Partner-only: CRUD this restaurant’s own menu and fulfill its orders.',
  },
  'orders.fulfill': {
    label: 'Fulfill orders',
    desc: 'Partner-only: advance a meal order through its delivery states.',
  },
  'partners.manage': {
    label: 'Manage meal partners',
    desc: 'Create, edit, and deactivate restaurant partner accounts.',
  },
  'orders.review': {
    label: 'Review meal orders',
    desc: 'Oversight and override across every partner’s orders.',
  },
  'gyms.manage': {
    label: 'Manage gyms',
    desc: 'CRUD the nearby-gyms directory and its photos.',
  },
} satisfies Record<Permission, { label: string; desc: string }>;

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

  // Per-account permission overrides (P2-20). Opened for a manageable, non-self
  // staff row so the operator can grant one extra capability or strip a preset
  // one on top of the role. super_admin rows are never eligible (safety floor).
  const [permsTarget, setPermsTarget] = useState<StaffMember | null>(null);

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
            {!isSelf && manageable && row.role !== 'super_admin' ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setPermsTarget(row)}
              >
                Permissions
              </Button>
            ) : null}
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
              <span style={{ fontSize: 12, color: 'var(--gt-danger)', maxWidth: 220 }}>
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

      <PermissionsModal target={permsTarget} onClose={() => setPermsTarget(null)} />
    </div>
  );
}

/** One permission's provenance, mirroring the GET/PUT payload rows. */
interface PermissionRow {
  key: Permission;
  preset: boolean;
  override: 'allow' | 'deny' | null;
  effective: boolean;
}

interface PermissionsPayload {
  accountId: string;
  role: StaffRole;
  locked: boolean;
  permissions: PermissionRow[];
}

/**
 * Per-account permission overrides (P2-20). Loads the target's effective
 * permission set with provenance, then lets the operator set each key to
 * Default (role preset), Grant (force-allow), or Deny (force-strip). Every
 * choice is an immediate single-key PUT that returns the fresh payload, so the
 * panel always reflects server truth — no optimistic drift. The header states
 * the rule the operator is composing: effective = preset + grants − denials.
 *
 * The route re-checks the permission, rank, self-target, and super_admin floor
 * independently; the greying here is a courtesy, not the guard.
 */
function PermissionsModal({
  target,
  onClose,
}: {
  target: StaffMember | null;
  onClose: () => void;
}) {
  const open = target != null;
  const accountId = target?.accountId ?? null;

  const [payload, setPayload] = useState<PermissionsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<Permission | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/staff/${encodeURIComponent(id)}/permissions`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const code = await errorCodeOf(res);
        setError(friendlyStaffError(res.status, code));
        setPayload(null);
        return;
      }
      setPayload((await res.json()) as PermissionsPayload);
    } catch {
      setError('Network error.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // (Re)load whenever a new target opens; clear stale state on close.
  useEffect(() => {
    if (!accountId) {
      setPayload(null);
      setError(null);
      return;
    }
    void load(accountId);
  }, [accountId, load]);

  async function setOverride(perm: Permission, allow: boolean | null) {
    if (!accountId) return;
    setBusyKey(perm);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/staff/${encodeURIComponent(accountId)}/permissions`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ perm, allow }),
        },
      );
      if (!res.ok) {
        const code = await errorCodeOf(res);
        setError(friendlyStaffError(res.status, code));
        return;
      }
      // The PUT returns the fresh, fully-merged payload — adopt it wholesale so
      // the panel can never disagree with what enforcement will do.
      setPayload((await res.json()) as PermissionsPayload);
    } catch {
      setError('Network error.');
    } finally {
      setBusyKey(null);
    }
  }

  const overrideCount =
    payload?.permissions.filter((p) => p.override != null).length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Permissions"
      width={560}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <p style={{ fontSize: 14, color: 'var(--gt-text)', margin: 0 }}>
            {target?.coachName || target?.displayName || target?.email}
          </p>
          <p style={{ fontSize: 12, color: 'var(--gt-text-dim)', margin: '4px 0 0' }}>
            {target ? staffRoleLabel(target.role) : ''} · effective ={' '}
            <strong style={{ color: 'var(--gt-text)' }}>preset</strong> + grants − denials
            {overrideCount > 0 ? ` · ${overrideCount} override${overrideCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Loading permissions…
          </div>
        ) : payload ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              maxHeight: 420,
              overflowY: 'auto',
            }}
          >
            {payload.locked ? (
              <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                A super admin holds every permission and cannot be overridden.
              </div>
            ) : null}
            {payload.permissions.map((row) => (
              <PermissionControl
                key={row.key}
                row={row}
                busy={busyKey === row.key}
                disabled={payload.locked || (busyKey != null && busyKey !== row.key)}
                onChange={(allow) => void setOverride(row.key, allow)}
              />
            ))}
          </div>
        ) : null}

        {error ? <div style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{error}</div> : null}
      </div>
    </Modal>
  );
}

/**
 * One permission line: label + description, an effective-state badge, and a
 * three-way Default / Grant / Deny selector. "Default" clears the override
 * (revert to preset); Grant/Deny write an explicit allow/deny. The currently
 * selected mode is derived from `row.override` (null → Default).
 */
function PermissionControl({
  row,
  busy,
  disabled,
  onChange,
}: {
  row: PermissionRow;
  busy: boolean;
  disabled: boolean;
  onChange: (allow: boolean | null) => void;
}) {
  const meta = PERMISSION_META[row.key];
  const mode: 'default' | 'allow' | 'deny' =
    row.override === 'allow' ? 'allow' : row.override === 'deny' ? 'deny' : 'default';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--gt-border)',
        background: row.override != null ? 'var(--gt-surface-sunken)' : 'transparent',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meta?.label ?? row.key}
          </span>
          {row.effective ? (
            <Badge tone="positive">On</Badge>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--gt-text-dim)', marginTop: 2 }}>
          {meta?.desc ?? row.key} · preset {row.preset ? 'grants' : 'denies'} this
        </div>
      </div>
      <div style={{ display: 'flex', gap: 0, flexShrink: 0 }} role="group" aria-label={`${meta?.label ?? row.key} override`}>
        <SegBtn
          label="Default"
          active={mode === 'default'}
          activeText="var(--gt-text)"
          busy={busy}
          disabled={disabled}
          onClick={() => onChange(null)}
        />
        <SegBtn
          label="Grant"
          active={mode === 'allow'}
          activeTone="var(--gt-success)"
          busy={busy}
          disabled={disabled}
          onClick={() => onChange(true)}
        />
        <SegBtn
          label="Deny"
          active={mode === 'deny'}
          activeTone="var(--gt-danger)"
          busy={busy}
          disabled={disabled}
          onClick={() => onChange(false)}
        />
      </div>
    </div>
  );
}

/** One segment of the Default/Grant/Deny control. */
function SegBtn({
  label,
  active,
  activeTone = 'var(--gt-border-strong)',
  activeText = 'var(--gt-accent-ink)',
  busy,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  activeTone?: string;
  /** Text color while active — pass 'var(--gt-text)' when activeTone is a light wash. */
  activeText?: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled || busy}
      onClick={onClick}
      style={{
        fontSize: 12,
        fontFamily: 'var(--font-heading)',
        padding: '5px 10px',
        border: '1px solid var(--gt-border)',
        marginLeft: -1,
        background: active ? activeTone : 'transparent',
        color: active ? activeText : 'var(--gt-text-dim)',
        cursor: disabled || busy ? 'default' : 'pointer',
        opacity: disabled || busy ? 0.55 : 1,
      }}
    >
      {label}
    </button>
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
              <div style={{ color: 'var(--gt-warning)', marginTop: 4 }}>
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

        {error ? <div style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{error}</div> : null}
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
              border: '1px solid var(--gt-accent)',
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
          <div style={{ fontSize: 13, color: 'var(--gt-danger)' }}>{error}</div>
        ) : null}
      </div>
    </Modal>
  );
}
