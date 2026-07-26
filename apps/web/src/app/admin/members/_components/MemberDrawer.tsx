'use client';

import {
  ACCOUNT_DELETION_BLOCKER_CODES,
  canManageRole,
  effectiveTier,
  type AccountDeletionBlockerCode,
  type Permission,
} from '@gym/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  Badge,
  Button,
  ConfirmButton,
  Drawer,
  SkeletonBar,
  StatusChip,
  TierChip,
} from '@/components/console';
import { formatDate, formatDateTime } from '@/lib/format';
import { staffRoleLabel } from '@/app/admin/_lib/staffRoleLabel';
import { tierLabel } from '@/app/admin/_lib/tierLabel';
import type { StaffRole } from '@/lib/auth';
import { CopyButton } from '../../_components/CopyButton';
import type {
  CoachOption,
  MemberDetail,
  MemberRow,
  Tier,
} from './types';

const TIERS: Tier[] = ['starter', 'silver', 'gold', 'elite'];

/** A Date → the `YYYY-MM-DD` value an `<input type="date">` expects, in LOCAL
 * time (the admin picks a calendar day as they see it, not a UTC one). */
function toDateInput(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Seeds the expiry field from a stored `tierExpiresAt`. A window that has
 * ALREADY closed seeds BLANK, never itself: re-submitting a stale past expiry
 * is the silent no-op (server rejects it as expiry_in_past) that the explicit
 * window rule exists to prevent, and "renew" must not carry it forward.
 */
function futureExpiryInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return '';
  return toDateInput(d);
}

/** The picked calendar day → an ISO instant at the END of that local day, so
 * "expires Aug 5" means the member keeps access through all of Aug 5. */
function expiryInputToIso(value: string): string | null {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

const accountDeletionErrorSchema = z.object({
  error: z.string(),
  impact: z
    .object({
      blockers: z.array(
        z.object({
          code: z.enum(ACCOUNT_DELETION_BLOCKER_CODES),
        }),
      ),
    })
    .optional(),
});

/**
 * Member detail Drawer. Opens when `memberId` is set; fetches the full detail
 * (profile blob, current tier/status, assigned coach) from
 * GET /api/admin/members/[id]. `fallback` (the table row) seeds the header so
 * the panel isn't blank while the detail loads.
 *
 * Actions (each only rendered if the caller's EFFECTIVE permission set allows
 * it — `callerPermissions` already merges per-account overrides, so a granted
 * or stripped permission is honored here, unlike a role-only `hasPermission`
 * check which ignored overrides; P1-7):
 *  - change tier      → PATCH /api/admin/members/[id] { tier, reason }
 *  - suspend/reactivate → PATCH /api/admin/members/[id] { status, reason }
 *  - assign a coach   → POST /api/admin/assignments { coachId, userId, force? }
 *  - credentials/data → members.manage_credentials sub-panels
 * Every fetch sends credentials:'include' for the httpOnly gt_staff cookie.
 * After any success we re-fetch detail (fresh coach/tier/status) and call
 * onMutated() so the parent table refreshes.
 *
 * `callerRole` is still passed for the RANK gate (canManageRole needs the
 * actor's role, which no permission key encodes); every permission decision
 * otherwise flows through `callerPermissions`.
 */
export function MemberDrawer({
  memberId,
  fallback,
  coaches,
  callerRole,
  callerPermissions,
  onClose,
  onMutated,
}: {
  memberId: string | null;
  fallback: MemberRow | null;
  coaches: CoachOption[];
  callerRole: StaffRole;
  callerPermissions: ReadonlySet<Permission>;
  onClose: () => void;
  onMutated: () => void;
}) {
  // All permission gating is override-aware (derived from the effective set),
  // not role-preset-only (P1-7 — the credentials gate previously used
  // hasPermission(callerRole, …) and ignored per-account grants/denials).
  const canSuspend = callerPermissions.has('members.suspend');
  const canTier = callerPermissions.has('subscription.override');
  const canAssign = callerPermissions.has('coach.assign');
  const canManageCredentials = callerPermissions.has('members.manage_credentials');
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state for the tier action.
  const [tierChoice, setTierChoice] = useState<Tier>('starter');
  // End of the granted window as a `YYYY-MM-DD` date-input value; '' = no
  // expiry (permanent). Seeded from the member's stored expiry when that window
  // is still open, blank otherwise.
  const [tierExpiry, setTierExpiry] = useState('');
  const [tierReason, setTierReason] = useState('');
  const [coachChoice, setCoachChoice] = useState('');
  // Suspend reason (audited via PATCH { status, reason }) — P1-7.
  const [suspendReason, setSuspendReason] = useState('');
  // Set when an assign is blocked by the coach's capacity/inactive guard (409);
  // surfaces an "assign anyway" override that retries with { force: true } (P1-7).
  const [assignBlock, setAssignBlock] = useState<'full' | 'inactive' | null>(null);
  // The coach id that actually triggered assignBlock. "Assign anyway" must only
  // be armed while coachChoice still matches this id — otherwise switching the
  // dropdown after a 409 would silently force-assign a different, never-checked
  // coach (mirrors mobile's assignOverrideFor === coach.id scoping).
  const [assignBlockCoachId, setAssignBlockCoachId] = useState<string | null>(null);

  // Credential-management (members.manage_credentials) action state. The
  // server is the boundary either way; the panel is additionally rank-locked in
  // the render below so a staff/partner row a caller can't manage never exposes
  // these controls.
  const [credBusy, setCredBusy] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [emailEdit, setEmailEdit] = useState('');
  const [nameEdit, setNameEdit] = useState('');
  const [signOutMsg, setSignOutMsg] = useState<string | null>(null);
  const [gdprConfirm, setGdprConfirm] = useState('');

  // Monotonic request sequence (mirrors MembersDirectory's fetchPage guard):
  // opening a member bumps this before firing the fetch, and the response
  // only commits state if it's still the newest request in flight. Without
  // this, a slow response for a previously opened member can land after a
  // newer member's drawer is already open and silently overwrite its
  // detail/tier/coach/status state.
  const reqSeq = useRef(0);

  const load = useCallback(async (id: string) => {
    const mySeq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${id}`, {
        credentials: 'include',
      });
      if (mySeq !== reqSeq.current) return; // superseded by a newer request
      if (!res.ok) {
        setError('Could not load this member.');
        setDetail(null);
        return;
      }
      const data = (await res.json()) as MemberDetail;
      if (mySeq !== reqSeq.current) return; // superseded while parsing
      setDetail(data);
      setTierChoice(data.member.tier);
      setTierExpiry(futureExpiryInput(data.member.tierExpiresAt));
      setTierReason('');
      setCoachChoice('');
      setSuspendReason('');
      setAssignBlock(null);
    } catch {
      if (mySeq !== reqSeq.current) return;
      setError('Could not load this member.');
      setDetail(null);
    } finally {
      if (mySeq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Reset per-member credential action state whenever the drawer retargets so
    // a stale reset link / sign-out message / typed-confirm never bleeds across
    // members.
    setCredError(null);
    setResetLink(null);
    setSignOutMsg(null);
    setGdprConfirm('');
    setSuspendReason('');
    setTierExpiry('');
    setAssignBlock(null);
    if (!memberId) {
      setDetail(null);
      setError(null);
      return;
    }
    void load(memberId);
  }, [memberId, load]);

  // Seed the identity-correction inputs from the loaded detail (and re-seed
  // after a successful save reloads it).
  useEffect(() => {
    if (detail) {
      setEmailEdit(detail.member.email);
      setNameEdit(detail.member.displayName);
    }
  }, [detail]);

  async function patch(body: Record<string, unknown>) {
    if (!memberId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${memberId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code = typeof data.error === 'string' ? data.error : null;
        } catch {
          code = null;
        }
        setError(
          code === 'insufficient_rank'
            ? 'Only a higher-ranked admin can change this staff member’s account.'
            : code === 'partner_target'
              ? 'Partner accounts are managed in the Partners console, not here.'
              : code === 'cannot_target_self'
                ? 'You cannot change your own account this way.'
                : code === 'expiry_in_past'
                  ? 'Pick an end date in the future. An already-passed date would leave the member on Starter.'
                  : res.status === 403
                    ? 'You do not have permission for that action.'
                    : 'That change could not be saved.',
        );
        return;
      }
      await load(memberId);
      onMutated();
    } catch {
      setError('That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function assignCoach(force = false) {
    if (!memberId || !coachChoice) return;
    const attemptedCoachId = coachChoice;
    setBusy(true);
    setError(null);
    setAssignBlock(null);
    setAssignBlockCoachId(null);
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId: attemptedCoachId, userId: memberId, force }),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code = typeof data.error === 'string' ? data.error : null;
        } catch {
          code = null;
        }
        // 409 full/inactive is a soft, overridable block: the coach is at
        // capacity or not accepting clients. Offer an explicit force-retry
        // instead of a dead end (P1-7). Record which coach id was actually
        // checked so "Assign anyway" can't silently carry over to a
        // different coach selected afterward.
        if (res.status === 409 && (code === 'full' || code === 'inactive')) {
          setAssignBlock(code);
          setAssignBlockCoachId(attemptedCoachId);
          return;
        }
        setError(
          res.status === 403
            ? 'You do not have permission to assign coaches.'
            : 'Could not assign that coach.',
        );
        return;
      }
      await load(memberId);
      onMutated();
    } catch {
      setError('Could not assign that coach.');
    } finally {
      setBusy(false);
    }
  }

  // Map a credential-route error code to member-facing copy.
  function credErrorCopy(
    status: number,
    code: string | null,
    deletionBlockers: readonly AccountDeletionBlockerCode[] = [],
  ): string {
    if (code === 'email_taken') return 'That email is already used by another account.';
    if (code === 'insufficient_rank')
      return 'Only a higher-ranked admin can manage this staff member’s credentials.';
    if (code === 'confirm_mismatch') return 'The confirmation email did not match.';
    if (code === 'private_asset_cleanup_pending')
      return 'Private progress-photo cleanup is incomplete. Nothing else was deleted; retry after storage recovers.';
    if (code === 'account_deletion_conflict')
      return 'The account changed while deletion was starting. Nothing was deleted; refresh and review it again.';
    if (code === 'account_deletion_blocked') {
      const blockers = new Set(deletionBlockers);
      if (
        blockers.has('live_meal_orders') ||
        blockers.has('open_meal_subscriptions')
      ) {
        return 'Finish or cancel the member’s active meal orders and subscriptions first. Nothing was deleted.';
      }
      if (
        blockers.has('pending_meal_payment_requests') ||
        blockers.has('pending_membership_payment_requests')
      ) {
        return 'Resolve the member’s pending payment reviews first. Nothing was deleted.';
      }
      if (
        blockers.has('staff_offboarding_required') ||
        blockers.has('partner_offboarding_required') ||
        blockers.has('coach_offboarding_required')
      ) {
        return 'Offboard this staff, coach, or meal-partner identity and its active relationships first. Nothing was deleted.';
      }
      if (blockers.has('legacy_identity_ambiguous')) {
        return 'Multiple legacy profiles match this email. Verify the correct identity before erasure; nothing was deleted.';
      }
      return 'Order, payment, discount, or payout history requires retention. Use the verified retention/anonymization process; nothing was deleted.';
    }
    if (status === 403) return 'You do not have permission for that action.';
    if (status === 404) return 'This member no longer exists.';
    return 'That action could not be completed.';
  }

  async function generateResetLink() {
    if (!memberId) return;
    setCredBusy(true);
    setCredError(null);
    try {
      const res = await fetch(`/api/admin/members/${memberId}/credentials`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          code = ((await res.json()) as { error?: unknown }).error as string;
        } catch {
          code = null;
        }
        setCredError(credErrorCopy(res.status, code));
        return;
      }
      const data = (await res.json()) as { resetUrl: string; expiresAt: string };
      setResetLink({ url: data.resetUrl, expiresAt: data.expiresAt });
    } catch {
      setCredError('That action could not be completed.');
    } finally {
      setCredBusy(false);
    }
  }

  async function saveIdentity() {
    if (!memberId || !detail) return;
    const body: { email?: string; displayName?: string } = {};
    const email = emailEdit.trim().toLowerCase();
    const name = nameEdit.trim();
    if (email && email !== detail.member.email) body.email = email;
    if (name && name !== detail.member.displayName) body.displayName = name;
    if (Object.keys(body).length === 0) return;
    setCredBusy(true);
    setCredError(null);
    try {
      const res = await fetch(`/api/admin/members/${memberId}/credentials`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          code = ((await res.json()) as { error?: unknown }).error as string;
        } catch {
          code = null;
        }
        setCredError(credErrorCopy(res.status, code));
        return;
      }
      await load(memberId);
      onMutated();
    } catch {
      setCredError('That change could not be saved.');
    } finally {
      setCredBusy(false);
    }
  }

  async function forceSignOut() {
    if (!memberId) return;
    setCredBusy(true);
    setCredError(null);
    setSignOutMsg(null);
    try {
      const res = await fetch(`/api/admin/members/${memberId}/sessions`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          code = ((await res.json()) as { error?: unknown }).error as string;
        } catch {
          code = null;
        }
        setCredError(credErrorCopy(res.status, code));
        return;
      }
      const data = (await res.json()) as { revoked: number };
      setSignOutMsg(
        data.revoked === 0
          ? 'No active sessions. The member was already signed out.'
          : `Signed out of ${data.revoked} session${data.revoked === 1 ? '' : 's'}.`,
      );
    } catch {
      setCredError('That action could not be completed.');
    } finally {
      setCredBusy(false);
    }
  }

  async function eraseAccount() {
    if (!memberId) return;
    setCredBusy(true);
    setCredError(null);
    try {
      const res = await fetch(`/api/admin/members/${memberId}/gdpr`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: gdprConfirm.trim() }),
      });
      if (!res.ok) {
        let code: string | null = null;
        let deletionBlockers: AccountDeletionBlockerCode[] = [];
        try {
          const parsedError = accountDeletionErrorSchema.safeParse(await res.json());
          if (parsedError.success) {
            code = parsedError.data.error;
            deletionBlockers =
              parsedError.data.impact?.blockers.map((blocker) => blocker.code) ?? [];
          }
        } catch {
          code = null;
        }
        setCredError(credErrorCopy(res.status, code, deletionBlockers));
        return;
      }
      // The account is gone — refresh the directory and close the drawer.
      onMutated();
      onClose();
    } catch {
      setCredError('That action could not be completed.');
    } finally {
      setCredBusy(false);
    }
  }

  const header =
    detail?.member.displayName?.trim() ||
    fallback?.displayName?.trim() ||
    detail?.member.email ||
    fallback?.email ||
    'Member';

  const currentTier = detail?.member.tier ?? fallback?.tier ?? 'starter';
  const currentStatus = detail?.member.status ?? fallback?.status ?? 'active';

  // Rank gate: the server rank-checks BOTH tier and status changes against an
  // account whose staff role the caller cannot manage (insufficient_rank on
  // either field — see PATCH /api/admin/members/[id]), so pre-empt it here by
  // disabling both sets of controls with a reason instead of letting the
  // staffer fill the form out and only discover the rejection on submit.
  const memberStaffRole =
    detail?.member.staffRole ?? fallback?.staffRole ?? null;
  // Partner logins are NOT managed here at all — the server rejects
  // suspend/tier on a partner target (partner_target), and credentials/data
  // controls are hidden too. Mirror that lock in the UI so nothing looks
  // actionable that the server will refuse (P1-8).
  const isPartnerTarget = memberStaffRole === 'partner';
  const statusLocked =
    isPartnerTarget ||
    (memberStaffRole != null && !canManageRole(callerRole, memberStaffRole));
  // Explains WHY the sensitive controls are locked (staff rank vs partner).
  const lockNote = isPartnerTarget
    ? 'Partner accounts are managed in the Partners console, not here.'
    : memberStaffRole != null
      ? `This member is staff (${staffRoleLabel(memberStaffRole)}), so only a higher-ranked admin can manage this account.`
      : '';

  // Lapsed = a non-starter stored tier whose dated window has already expired
  // (contract §4.7's tierExpiresAt). The console would otherwise show
  // 'gold'/'elite' as if it were live even though effectiveTier() has already
  // collapsed the account to 'starter' at every auth choke point.
  const tierExpiresAt = detail?.member.tierExpiresAt ?? fallback?.tierExpiresAt ?? null;
  const isLapsed =
    currentTier !== 'starter' &&
    effectiveTier(currentTier, tierExpiresAt, new Date()) === 'starter';

  // The expiry currently ON the account, as a date-input value — blank when the
  // window has already closed, so a lapsed member starts from "no expiry" and
  // never re-submits the stale date.
  const storedExpiryInput = futureExpiryInput(tierExpiresAt);
  // Dirty when the picked tier differs from the raw stored tier, when the END
  // DATE was changed, OR when the stored tier has lapsed — renewing a lapsed
  // tier back to its own value (the single most common console action) must
  // still surface the reason field + submit button, not silently no-op because
  // tierChoice === the raw (expired) currentTier.
  const tierDirty =
    canTier &&
    detail != null &&
    (tierChoice !== currentTier || isLapsed || tierExpiry !== storedExpiryInput);
  // Today, for the date picker's `min` — the server refuses a past window
  // outright (expiry_in_past), so don't let the picker offer one.
  const todayInput = toDateInput(new Date());

  return (
    <Drawer open={memberId != null} onClose={onClose} title={header} width={460}>
      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '10px 12px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            color: 'var(--gt-danger)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Who this is — identity first, then the facts that describe them. */}
      <section>
        <div
          style={{
            fontSize: 14,
            color: 'var(--gt-text-dim)',
            overflowWrap: 'anywhere',
          }}
        >
          {detail?.member.email ?? fallback?.email ?? ''}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <TierChip tier={currentTier} />
          {isLapsed ? <Badge tone="warning">Lapsed</Badge> : null}
          <StatusChip status={currentStatus} />
          {memberStaffRole != null ? (
            <Badge tone="info">{staffRoleLabel(memberStaffRole)}</Badge>
          ) : null}
        </div>
        {isLapsed && tierExpiresAt ? (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--gt-text-dim)' }}>
            {tierLabel(currentTier)} ended {formatDate(tierExpiresAt)}, so this member is on
            Starter now.
          </div>
        ) : null}
        {memberId ? (
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            {/* Quiet by design: the accent in this panel belongs to the one
                action that changes something, not to a side trip. */}
            <Link
              href={`/admin/members/${memberId}/view`}
              style={{
                fontSize: 13,
                color: 'var(--gt-text-dim)',
                textDecorationColor: 'var(--gt-border-strong)',
                textUnderlineOffset: 3,
              }}
            >
              Full member record
            </Link>
            {/* "Who changed this member, and when" — deep-links the audit log
                pre-filtered to this account, which is exactly the shape of the
                audit_log_target (target_type, target_id) index. Only offered to
                callers who actually hold audit.read; the audit page redirects
                everyone else. */}
            {callerPermissions.has('audit.read') ? (
              <Link
                href={`/admin/audit?targetType=account&targetId=${encodeURIComponent(memberId)}`}
                style={{
                  fontSize: 13,
                  color: 'var(--gt-text-dim)',
                  textDecorationColor: 'var(--gt-border-strong)',
                  textUnderlineOffset: 3,
                }}
              >
                Change history
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {loading ? (
        // Shaped like the definition list it becomes, so the panel settles
        // instead of jumping when the detail lands.
        <div
          role="status"
          aria-label="Loading this member"
          style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}
        >
          <SkeletonBar w="40%" h={10} />
          <SkeletonBar w="85%" />
          <SkeletonBar w="70%" />
          <SkeletonBar w="55%" />
        </div>
      ) : null}

      {!loading && detail ? (
        <>
          {/* Membership facts */}
          <FieldGroup label="Membership">
            <DefinitionList
              rows={[
                { label: 'Plan', value: tierLabel(currentTier) },
                {
                  label: 'Access until',
                  value:
                    currentTier === 'starter'
                      ? 'Not applicable'
                      : tierExpiresAt
                        ? formatDate(tierExpiresAt)
                        : 'No end date',
                  numeric: Boolean(tierExpiresAt) && currentTier !== 'starter',
                },
                {
                  label: 'Coach',
                  value: detail.coach
                    ? detail.coach.displayName || detail.coach.email
                    : 'None assigned',
                },
                {
                  label: 'Joined',
                  value: formatDate(detail.member.createdAt),
                  numeric: true,
                },
              ]}
            />
          </FieldGroup>

          {/* Profile summary */}
          <FieldGroup label="Profile">
            {detail.profile && Object.keys(detail.profile).length > 0 ? (
              <ProfileSummary data={detail.profile} />
            ) : (
              <Muted>This member has not filled in their profile yet.</Muted>
            )}
          </FieldGroup>

          <SectionTitle hint="Changes save straight away and are recorded against your name.">
            Manage this member
          </SectionTitle>

          {/* Assigned coach */}
          <FieldGroup label="Coach">
            {detail.coach ? (
              <div style={{ fontSize: 14 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600 }}>
                  {detail.coach.displayName}
                </div>
                <div style={{ color: 'var(--gt-text-dim)', fontSize: 13 }}>
                  {detail.coach.email}
                </div>
              </div>
            ) : (
              <Muted>No coach assigned.</Muted>
            )}
            {canAssign && coaches.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <select
                  className="gt-input"
                  value={coachChoice}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCoachChoice(next);
                    // A block armed for a previously-selected coach must not
                    // silently carry over onto a newly-selected one.
                    if (next !== assignBlockCoachId) {
                      setAssignBlock(null);
                      setAssignBlockCoachId(null);
                    }
                  }}
                  disabled={busy}
                  aria-label={detail.coach ? 'Move to another coach' : 'Choose a coach'}
                  style={{ flex: 1, cursor: 'pointer' }}
                >
                  <option value="">
                    {detail.coach ? 'Move to another coach' : 'Choose a coach'}
                  </option>
                  {coaches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !coachChoice}
                  onClick={() => void assignCoach()}
                >
                  {busy ? 'Saving…' : 'Assign'}
                </Button>
              </div>
            ) : null}
            {canAssign && assignBlock && assignBlockCoachId === coachChoice ? (
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  borderRadius: 'var(--gt-radius-sm)',
                  border: '1px solid color-mix(in srgb, var(--gt-warning) 32%, transparent)',
                  background: 'var(--gt-warning-weak)',
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--gt-text)' }}>
                  {assignBlock === 'full'
                    ? 'This coach is already at their client limit.'
                    : 'This coach is not taking new clients right now.'}{' '}
                  You can go ahead anyway.
                </div>
                <div style={{ marginTop: 10 }}>
                  <Button
                    variant="dark"
                    size="sm"
                    disabled={busy || !coachChoice || coachChoice !== assignBlockCoachId}
                    onClick={() => void assignCoach(true)}
                  >
                    {busy ? 'Assigning…' : 'Assign anyway'}
                  </Button>
                </div>
              </div>
            ) : null}
            {canAssign && coaches.length === 0 ? (
              <Muted>There are no coaches to assign yet.</Muted>
            ) : null}
          </FieldGroup>

          {/* Change tier */}
          {canTier ? (
            <FieldGroup label="Change plan">
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  className="gt-input"
                  value={tierChoice}
                  aria-label="Membership plan"
                  onChange={(e) => setTierChoice(e.target.value as Tier)}
                  disabled={busy || statusLocked}
                  style={{
                    flex: 1,
                    cursor: statusLocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {tierLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
              {statusLocked ? (
                <Muted>{lockNote}</Muted>
              ) : (
                <>
                  {/* End date for the granted window. Leaving it blank grants
                      the tier with NO expiry — which also means the store can
                      never downgrade this account again, so paid tiers should
                      normally carry a real end date. */}
                  {tierChoice !== 'starter' ? (
                    // A plain div, not a <label>: the row holds a second
                    // interactive control (Clear), which must not double as a
                    // click target for the date input. The input carries its own
                    // aria-label instead.
                    <div style={{ marginTop: 12 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 13,
                          color: 'var(--gt-text-dim)',
                          marginBottom: 6,
                        }}
                      >
                        Access until
                      </span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          className="gt-input"
                          type="date"
                          value={tierExpiry}
                          min={todayInput}
                          onChange={(e) => setTierExpiry(e.target.value)}
                          disabled={busy}
                          aria-label="Tier access end date"
                          style={{ flex: 1 }}
                        />
                        {tierExpiry ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setTierExpiry('')}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                      <Muted>
                        {tierExpiry
                          ? 'The member drops back to Starter after this date.'
                          : 'With no end date this member keeps the plan for good, and store renewals can no longer change it.'}
                      </Muted>
                    </div>
                  ) : null}
                  {tierDirty ? (
                    <>
                      <input
                        className="gt-input"
                        placeholder="Why are you making this change? (optional)"
                        aria-label="Reason for the plan change"
                        value={tierReason}
                        onChange={(e) => setTierReason(e.target.value)}
                        disabled={busy}
                        style={{ marginTop: 12 }}
                      />
                      <div style={{ marginTop: 10 }}>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void patch({
                              tier: tierChoice,
                              // Always explicit: a picked date, or null =
                              // permanent. Never inherits the stored (possibly
                              // stale) expiry.
                              expiresAt:
                                tierChoice === 'starter' || !tierExpiry
                                  ? null
                                  : expiryInputToIso(tierExpiry),
                              reason: tierReason.trim() || undefined,
                            })
                          }
                        >
                          {busy
                            ? 'Saving…'
                            : tierChoice === currentTier && isLapsed
                              ? `Renew ${tierLabel(tierChoice)}`
                              : tierChoice === currentTier
                                ? 'Update end date'
                                : `Change to ${tierLabel(tierChoice)}`}
                        </Button>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </FieldGroup>
          ) : null}

          {/* Suspend / reactivate */}
          {canSuspend ? (
            <FieldGroup label="Account status">
              {statusLocked ? (
                <>
                  <Button variant="ghost" size="sm" disabled>
                    {currentStatus === 'active'
                      ? 'Suspend account'
                      : 'Reactivate account'}
                  </Button>
                  <Muted>{lockNote}</Muted>
                </>
              ) : currentStatus === 'active' ? (
                <>
                  <input
                    className="gt-input"
                    placeholder="Why are you suspending them? (optional)"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    disabled={busy}
                    aria-label="Reason for suspending this member"
                    style={{ width: '100%', marginBottom: 10 }}
                  />
                  <ConfirmButton
                    label="Suspend account"
                    confirmLabel="Confirm suspend"
                    busyLabel="Suspending…"
                    busy={busy}
                    size="sm"
                    onConfirm={() =>
                      void patch({
                        status: 'suspended',
                        reason: suspendReason.trim() || undefined,
                      })
                    }
                  />
                  <Muted>
                    Suspending signs the member out of every device straight away.
                  </Muted>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void patch({ status: 'active' })}
                >
                  {busy ? 'Reactivating…' : 'Reactivate account'}
                </Button>
              )}
            </FieldGroup>
          ) : null}

          {/* Credentials & data (members.manage_credentials — super/main).
              Rank-locked: hidden for a staff/partner row the caller can't
              manage, mirroring the tier/status locks (P1-7). The credential
              routes rank-check server-side too — this only prevents a dead,
              server-rejected panel. */}
          {canManageCredentials && !statusLocked ? (
            <>
              <SectionTitle hint="Sign-in help and account removal. Handle with care.">
                Account tools
              </SectionTitle>

              {credError ? (
                <div
                  role="alert"
                  style={{
                    marginTop: 14,
                    padding: '10px 12px',
                    borderRadius: 'var(--gt-radius-sm)',
                    border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
                    background: 'var(--gt-danger-weak)',
                    color: 'var(--gt-danger)',
                    fontSize: 13,
                  }}
                >
                  {credError}
                </div>
              ) : null}

              {/* Password reset */}
              <FieldGroup label="Password reset">
                {resetLink ? (
                  <>
                    <input
                      className="gt-input"
                      readOnly
                      value={resetLink.url}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label="One-time password reset link"
                      style={{ width: '100%', fontSize: 13 }}
                    />
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        marginTop: 10,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      {/* A blocked clipboard used to look exactly like a
                          successful copy, so the link that "worked" was
                          whatever had been copied an hour earlier. */}
                      <CopyButton
                        key={resetLink.url}
                        value={resetLink.url}
                        label="Copy link"
                        copiedLabel="Copied"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={credBusy}
                        onClick={() => void generateResetLink()}
                      >
                        {credBusy ? 'Working…' : 'Regenerate'}
                      </Button>
                    </div>
                    <Muted>
                      No email is sent, so pass this link to the member yourself. It works
                      once and expires {formatDateTime(resetLink.expiresAt)}. Making a new
                      one cancels this link.
                    </Muted>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={credBusy}
                      onClick={() => void generateResetLink()}
                    >
                      {credBusy ? 'Working…' : 'Create a reset link'}
                    </Button>
                    <Muted>
                      Creates a one-time link, good for an hour, that lets the member set a
                      new password. No email is sent, so you hand it over yourself.
                    </Muted>
                  </>
                )}
              </FieldGroup>

              {/* Login identity */}
              <FieldGroup label="Sign-in details">
                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: 'var(--gt-text-dim)',
                      marginBottom: 6,
                    }}
                  >
                    Email
                  </span>
                  <input
                    className="gt-input"
                    type="email"
                    value={emailEdit}
                    onChange={(e) => setEmailEdit(e.target.value)}
                    disabled={credBusy}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block' }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: 'var(--gt-text-dim)',
                      marginBottom: 6,
                    }}
                  >
                    Display name
                  </span>
                  <input
                    className="gt-input"
                    value={nameEdit}
                    onChange={(e) => setNameEdit(e.target.value)}
                    disabled={credBusy}
                    maxLength={120}
                    style={{ width: '100%' }}
                  />
                </label>
                {(() => {
                  const emailDirty =
                    emailEdit.trim() !== '' &&
                    emailEdit.trim().toLowerCase() !== detail.member.email;
                  const nameDirty =
                    nameEdit.trim() !== '' && nameEdit.trim() !== detail.member.displayName;
                  const dirty = emailDirty || nameDirty;
                  return dirty ? (
                    <div style={{ marginTop: 12 }}>
                      <Button
                        size="sm"
                        variant="dark"
                        disabled={credBusy}
                        onClick={() => void saveIdentity()}
                      >
                        {credBusy ? 'Saving…' : 'Save sign-in details'}
                      </Button>
                    </div>
                  ) : null;
                })()}
              </FieldGroup>

              {/* Sessions */}
              <FieldGroup label="Devices">
                <ConfirmButton
                  label="Sign out everywhere"
                  confirmLabel="Confirm sign-out"
                  busyLabel="Signing out…"
                  busy={credBusy}
                  size="sm"
                  onConfirm={() => void forceSignOut()}
                />
                {signOutMsg ? (
                  <Muted>{signOutMsg}</Muted>
                ) : (
                  <Muted>
                    Signs the member out of every device without suspending them. They can
                    sign straight back in with their password.
                  </Muted>
                )}
              </FieldGroup>

              {/* GDPR erasure (danger) */}
              <FieldGroup label="Delete this account" tone="danger">
                <div style={{ fontSize: 13, color: 'var(--gt-text)' }}>
                  This cannot be undone. Deletion only goes ahead for an account with
                  nothing left open: live services, staff, coach or partner access, an
                  unclear identity, or order and payment history that must be kept will
                  stop it, and nothing is removed in that case.
                </div>
                <input
                  className="gt-input"
                  value={gdprConfirm}
                  onChange={(e) => setGdprConfirm(e.target.value)}
                  disabled={credBusy}
                  placeholder="Type the member’s email to confirm"
                  aria-label="Type the member’s email to confirm deletion"
                  style={{ width: '100%', marginTop: 12 }}
                />
                <div style={{ marginTop: 10 }}>
                  <ConfirmButton
                    label="Delete account"
                    confirmLabel="Permanently delete"
                    busyLabel="Deleting…"
                    busy={credBusy}
                    size="sm"
                    onConfirm={() => {
                      if (
                        gdprConfirm.trim().toLowerCase() === detail.member.email.toLowerCase()
                      ) {
                        void eraseAccount();
                      } else {
                        setCredError('Type the member’s exact email to confirm deletion.');
                      }
                    }}
                  />
                </div>
              </FieldGroup>
            </>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}

/**
 * One labelled block inside the drawer. `tone="danger"` marks the block whose
 * action cannot be taken back, so the eye finds it before the hand does.
 */
function FieldGroup({
  label,
  children,
  tone = 'plain',
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'plain' | 'danger';
}) {
  const danger = tone === 'danger';
  return (
    <section
      style={{
        paddingTop: 16,
        marginTop: 16,
        borderTop: '1px solid var(--gt-border)',
        ...(danger
          ? {
              padding: 14,
              marginTop: 20,
              border: '1px solid color-mix(in srgb, var(--gt-danger) 28%, transparent)',
              borderRadius: 'var(--gt-radius-sm)',
              background: 'var(--gt-danger-weak)',
            }
          : null),
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: danger ? 'var(--gt-danger)' : 'var(--gt-text-faint)',
          fontFamily: 'var(--font-heading)',
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {children}
    </section>
  );
}

/** Heading that separates the read-only profile above from the actions below. */
function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginTop: 22 }}>
      <h3
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 15,
          margin: 0,
          color: 'var(--gt-text)',
        }}
      >
        {children}
      </h3>
      {hint ? (
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--gt-text-dim)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 6 }}>
      {children}
    </div>
  );
}

/** A fact row for {@link DefinitionList}. `numeric` right-aligns in Oswald. */
interface Fact {
  label: string;
  value: React.ReactNode;
  numeric?: boolean;
}

/**
 * The drawer's read-only facts, as a real definition list: quiet term on the
 * left, value hard against the right edge so a column of them lines up and can
 * be read down rather than hunted for.
 */
function DefinitionList({ rows }: { rows: Fact[] }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gap: '8px 16px',
        margin: 0,
        fontSize: 14,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>
            {row.label}
          </dt>
          <dd
            className={row.numeric ? 'gt-numeric' : undefined}
            style={{
              margin: 0,
              textAlign: 'right',
              color: 'var(--gt-text)',
              overflowWrap: 'anywhere',
            }}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** `goal_type` / `veryActive` → `Goal type` / `Very active`. */
function humanValue(raw: unknown): string {
  const text = String(raw).trim();
  if (text === '') return '—';
  const spaced = text
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Renders a small subset of the cloud profile blob as labeled rows. The blob is
 * free-form (the mobile app's onboarding store), so we surface a curated set of
 * well-known keys when present and skip the rest — never dumping raw JSON, and
 * never printing a stored value like `very_active` at an operator.
 */
function ProfileSummary({ data }: { data: Record<string, unknown> }) {
  const known: { key: string; label: string; numeric?: boolean; verbatim?: boolean }[] = [
    { key: 'displayName', label: 'Name', verbatim: true },
    { key: 'sex', label: 'Sex' },
    { key: 'goalType', label: 'Goal' },
    { key: 'activityLevel', label: 'Activity' },
    { key: 'heightCm', label: 'Height', numeric: true },
    { key: 'unitPref', label: 'Units' },
  ];
  const rows: Fact[] = known
    .filter(({ key }) => {
      const v = data[key];
      return v !== undefined && v !== null && v !== '';
    })
    .map(({ key, label, numeric, verbatim }) => ({
      label,
      numeric,
      value:
        key === 'heightCm'
          ? `${String(data[key])} cm`
          : verbatim
            ? String(data[key])
            : humanValue(data[key]),
    }));

  if (rows.length === 0) {
    return <Muted>No profile details filled in yet.</Muted>;
  }

  return <DefinitionList rows={rows} />;
}
