'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  ConfirmButton,
  Drawer,
  SkeletonBar,
  StatusChip,
  TierChip,
} from '@/components/console';
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
  canSuspend,
  canTier,
  canAssign,
  onClose,
  onMutated,
}: {
  memberId: string | null;
  fallback: MemberRow | null;
  coaches: CoachOption[];
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

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${id}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setError('Could not load this member.');
        setDetail(null);
        return;
      }
      const data = (await res.json()) as MemberDetail;
      setDetail(data);
      setTierChoice(data.member.tier);
      setTierReason('');
      setCoachChoice('');
    } catch {
      setError('Could not load this member.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!memberId) {
      setDetail(null);
      setError(null);
      return;
    }
    void load(memberId);
  }, [memberId, load]);

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
        setError(
          res.status === 403
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

  const header =
    detail?.member.displayName?.trim() ||
    fallback?.displayName?.trim() ||
    detail?.member.email ||
    fallback?.email ||
    'Member';

  const currentTier = detail?.member.tier ?? fallback?.tier ?? 'starter';
  const currentStatus = detail?.member.status ?? fallback?.status ?? 'active';
  const tierDirty = canTier && detail != null && tierChoice !== currentTier;

  return (
    <Drawer open={memberId != null} onClose={onClose} title={header} width={460}>
      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,107,96,0.3)',
            background: 'rgba(255,107,96,0.08)',
            color: '#ff8178',
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
          <StatusChip status={currentStatus} />
        </div>
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
                  disabled={busy}
                  style={{
                    flex: 1,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {tierDirty ? (
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
                      {busy ? 'Saving…' : `Change to ${tierChoice}`}
                    </Button>
                  </div>
                </>
              ) : null}
            </FieldGroup>
          ) : null}

          {/* Suspend / reactivate */}
          {canSuspend ? (
            <FieldGroup label="Account status">
              {currentStatus === 'active' ? (
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
