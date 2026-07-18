'use client';

import { canManageRole, effectiveTier, hasPermission } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  ConfirmButton,
  Drawer,
  SkeletonBar,
  StatusChip,
  TierChip,
} from '@/components/console';
import { staffRoleLabel } from '@/app/admin/_lib/staffRoleLabel';
import type { StaffRole } from '@/lib/auth';
import type {
  CoachOption,
  MemberDetail,
  MemberRow,
  Tier,
} from './types';

const TIERS: Tier[] = ['starter', 'silver', 'gold', 'elite'];

/**
 * Member detail Drawer. Opens when `memberId` is set; fetches the full detail
 * (profile blob, current tier/status, assigned coach) from
 * GET /api/admin/members/[id]. `fallback` (the table row) seeds the header so
 * the panel isn't blank while the detail loads.
 *
 * Actions (each only rendered if the caller's role allows it):
 *  - change tier      → PATCH /api/admin/members/[id] { tier, reason }
 *  - suspend/reactivate → PATCH /api/admin/members/[id] { status }
 *  - assign a coach   → POST /api/admin/assignments { coachId, userId }
 * Every fetch sends credentials:'include' for the httpOnly gt_staff cookie.
 * After any success we re-fetch detail (fresh coach/tier/status) and call
 * onMutated() so the parent table refreshes.
 */
export function MemberDrawer({
  memberId,
  fallback,
  coaches,
  callerRole,
  canSuspend,
  canTier,
  canAssign,
  onClose,
  onMutated,
}: {
  memberId: string | null;
  fallback: MemberRow | null;
  coaches: CoachOption[];
  callerRole: StaffRole;
  canSuspend: boolean;
  canTier: boolean;
  canAssign: boolean;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state for the tier action.
  const [tierChoice, setTierChoice] = useState<Tier>('starter');
  const [tierReason, setTierReason] = useState('');
  const [coachChoice, setCoachChoice] = useState('');

  // Credential-management (members.manage_credentials) action state. Only the
  // super/main-admin flows below use these; everyone else never sees the
  // section (the server is the boundary either way).
  const canManageCredentials = hasPermission(callerRole, 'members.manage_credentials');
  const [credBusy, setCredBusy] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
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
      setTierReason('');
      setCoachChoice('');
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
    setLinkCopied(false);
    setSignOutMsg(null);
    setGdprConfirm('');
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
            : code === 'cannot_target_self'
              ? 'You cannot change your own account this way.'
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

  async function assignCoach() {
    if (!memberId || !coachChoice) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId: coachChoice, userId: memberId }),
      });
      if (!res.ok) {
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
  function credErrorCopy(status: number, code: string | null): string {
    if (code === 'email_taken') return 'That email is already used by another account.';
    if (code === 'insufficient_rank')
      return 'Only a higher-ranked admin can manage this staff member’s credentials.';
    if (code === 'confirm_mismatch') return 'The confirmation email did not match.';
    if (status === 403) return 'You do not have permission for that action.';
    if (status === 404) return 'This member no longer exists.';
    return 'That action could not be completed.';
  }

  async function generateResetLink() {
    if (!memberId) return;
    setCredBusy(true);
    setCredError(null);
    setLinkCopied(false);
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

  async function copyResetLink() {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink.url);
      setLinkCopied(true);
    } catch {
      // Clipboard blocked (insecure context / permissions) — the link is still
      // visible in the field for manual selection.
      setLinkCopied(false);
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
          ? 'No active sessions — the member was already signed out.'
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
        try {
          code = ((await res.json()) as { error?: unknown }).error as string;
        } catch {
          code = null;
        }
        setCredError(credErrorCopy(res.status, code));
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
  const statusLocked =
    memberStaffRole != null && !canManageRole(callerRole, memberStaffRole);

  // Lapsed = a non-starter stored tier whose dated window has already expired
  // (contract §4.7's tierExpiresAt). The console would otherwise show
  // 'gold'/'elite' as if it were live even though effectiveTier() has already
  // collapsed the account to 'starter' at every auth choke point.
  const tierExpiresAt = detail?.member.tierExpiresAt ?? fallback?.tierExpiresAt ?? null;
  const isLapsed =
    currentTier !== 'starter' &&
    effectiveTier(currentTier, tierExpiresAt, new Date()) === 'starter';

  // Dirty when the picked tier differs from the raw stored tier, OR when the
  // stored tier has lapsed — renewing a lapsed tier back to its own value
  // (the single most common console action) must still surface the reason
  // field + submit button, not silently no-op because tierChoice === the
  // raw (expired) currentTier.
  const tierDirty =
    canTier && detail != null && (tierChoice !== currentTier || isLapsed);

  return (
    <Drawer open={memberId != null} onClose={onClose} title={header} width={460}>
      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            color: 'var(--gt-danger)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Summary */}
      <section style={{ marginBottom: 22 }}>
        <div
          style={{
            fontSize: 14,
            color: 'var(--gt-text-dim)',
            wordBreak: 'break-all',
          }}
        >
          {detail?.member.email ?? fallback?.email ?? ''}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <TierChip tier={currentTier} />
          {isLapsed ? <Badge tone="warning">Lapsed</Badge> : null}
          <StatusChip status={currentStatus} />
          {memberStaffRole != null ? (
            <Badge tone="info">{staffRoleLabel(memberStaffRole)}</Badge>
          ) : null}
        </div>
        {isLapsed && tierExpiresAt ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gt-text-dim)' }}>
            {currentTier} expired{' '}
            {new Date(tierExpiresAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}{' '}
            — this member is on Starter now.
          </div>
        ) : !isLapsed && tierExpiresAt && currentTier !== 'starter' ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Renews/expires{' '}
            {new Date(tierExpiresAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        ) : null}
        {detail?.member.createdAt ? (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Joined{' '}
            {new Date(detail.member.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        ) : null}
      </section>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SkeletonBar w="70%" />
          <SkeletonBar w="55%" />
          <SkeletonBar w="80%" />
        </div>
      ) : null}

      {!loading && detail ? (
        <>
          {/* Profile summary */}
          <FieldGroup label="Profile">
            {detail.profile && Object.keys(detail.profile).length > 0 ? (
              <ProfileSummary data={detail.profile} />
            ) : (
              <Muted>No cloud profile on record.</Muted>
            )}
          </FieldGroup>

          {/* Assigned coach */}
          <FieldGroup label="Assigned coach">
            {detail.coach ? (
              <div style={{ fontSize: 14 }}>
                <div style={{ fontWeight: 500 }}>{detail.coach.displayName}</div>
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
                  onChange={(e) => setCoachChoice(e.target.value)}
                  disabled={busy}
                  style={{ flex: 1, cursor: 'pointer' }}
                >
                  <option value="">
                    {detail.coach ? 'Reassign to…' : 'Select a coach…'}
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
                  Assign
                </Button>
              </div>
            ) : null}
            {canAssign && coaches.length === 0 ? (
              <Muted>No coaches available to assign.</Muted>
            ) : null}
          </FieldGroup>

          {/* Change tier */}
          {canTier ? (
            <FieldGroup label="Subscription tier">
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  className="gt-input"
                  value={tierChoice}
                  onChange={(e) => setTierChoice(e.target.value as Tier)}
                  disabled={busy || statusLocked}
                  style={{
                    flex: 1,
                    textTransform: 'capitalize',
                    cursor: statusLocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {statusLocked ? (
                <Muted>
                  This member is staff ({staffRoleLabel(memberStaffRole)}) —
                  only a higher-ranked admin can change their tier.
                </Muted>
              ) : tierDirty ? (
                <>
                  <input
                    className="gt-input"
                    placeholder="Reason (optional, audited)"
                    value={tierReason}
                    onChange={(e) => setTierReason(e.target.value)}
                    disabled={busy}
                    style={{ marginTop: 8 }}
                  />
                  <div style={{ marginTop: 10 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void patch({
                          tier: tierChoice,
                          reason: tierReason.trim() || undefined,
                        })
                      }
                    >
                      {busy
                        ? 'Saving…'
                        : tierChoice === currentTier && isLapsed
                          ? `Renew ${tierChoice}`
                          : `Change to ${tierChoice}`}
                    </Button>
                  </div>
                </>
              ) : null}
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
                  <Muted>
                    This member is staff ({staffRoleLabel(memberStaffRole)}) —
                    managed by a higher-ranked admin.
                  </Muted>
                </>
              ) : currentStatus === 'active' ? (
                <>
                  <ConfirmButton
                    label="Suspend account"
                    confirmLabel="Confirm suspend"
                    busyLabel="Suspending…"
                    busy={busy}
                    size="sm"
                    onConfirm={() => void patch({ status: 'suspended' })}
                  />
                  <Muted>
                    Suspending immediately signs the member out of every device.
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

          {/* Credentials & data (members.manage_credentials — super/main) */}
          {canManageCredentials ? (
            <>
              {credError ? (
                <div
                  role="alert"
                  style={{
                    marginTop: 16,
                    padding: '10px 12px',
                    borderRadius: 10,
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
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <Button size="sm" variant="ghost" onClick={() => void copyResetLink()}>
                        {linkCopied ? 'Copied' : 'Copy link'}
                      </Button>
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
                      No email is sent. Copy this link and give it to the member — it works
                      once and expires{' '}
                      {new Date(resetLink.expiresAt).toLocaleString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                        month: 'short',
                        day: 'numeric',
                      })}
                      . Generating it invalidates any earlier link.
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
                      {credBusy ? 'Working…' : 'Generate reset link'}
                    </Button>
                    <Muted>
                      Mints a single-use, 1-hour link the member uses to set a new password.
                      There is no email delivery — you hand it over directly.
                    </Muted>
                  </>
                )}
              </FieldGroup>

              {/* Login identity */}
              <FieldGroup label="Login identity">
                <label style={{ display: 'block', marginBottom: 10 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 12,
                      color: 'var(--gt-text-dim)',
                      marginBottom: 4,
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
                      fontSize: 12,
                      color: 'var(--gt-text-dim)',
                      marginBottom: 4,
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
                    <div style={{ marginTop: 10 }}>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={credBusy}
                        onClick={() => void saveIdentity()}
                      >
                        {credBusy ? 'Saving…' : 'Save changes'}
                      </Button>
                    </div>
                  ) : null;
                })()}
              </FieldGroup>

              {/* Sessions */}
              <FieldGroup label="Sessions">
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
                    Revokes every active session without suspending the account — the member
                    can sign back in with their password.
                  </Muted>
                )}
              </FieldGroup>

              {/* GDPR erasure (danger) */}
              <FieldGroup label="Delete account (GDPR)">
                <Muted>
                  Permanently erases this account and everything it owns. History that
                  references others is anonymized. This cannot be undone.
                </Muted>
                <input
                  className="gt-input"
                  value={gdprConfirm}
                  onChange={(e) => setGdprConfirm(e.target.value)}
                  disabled={credBusy}
                  placeholder="Type the member’s email to confirm"
                  aria-label="Type the member’s email to confirm deletion"
                  style={{ width: '100%', marginTop: 10 }}
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

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        paddingTop: 16,
        marginTop: 16,
        borderTop: '1px solid var(--gt-border)',
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
        {label}
      </div>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 6 }}>
      {children}
    </div>
  );
}

/**
 * Renders a small subset of the cloud profile blob as labeled rows. The blob is
 * free-form (the mobile app's onboarding store), so we surface a curated set of
 * well-known keys when present and skip the rest — never dumping raw JSON.
 */
function ProfileSummary({ data }: { data: Record<string, unknown> }) {
  const known: [string, string][] = [
    ['displayName', 'Name'],
    ['sex', 'Sex'],
    ['goalType', 'Goal'],
    ['activityLevel', 'Activity'],
    ['heightCm', 'Height (cm)'],
    ['unitPref', 'Units'],
  ];
  const rows = known
    .map(([key, label]) => [label, data[key]] as const)
    .filter(([, v]) => v !== undefined && v !== null && v !== '');

  if (rows.length === 0) {
    return <Muted>Profile present, but no summary fields set.</Muted>;
  }

  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '6px 16px',
        margin: 0,
        fontSize: 14,
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--gt-text-dim)' }}>{label}</dt>
          <dd
            style={{
              margin: 0,
              textAlign: 'right',
              textTransform:
                label === 'Sex' || label === 'Goal' || label === 'Activity'
                  ? 'capitalize'
                  : 'none',
            }}
          >
            {String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
