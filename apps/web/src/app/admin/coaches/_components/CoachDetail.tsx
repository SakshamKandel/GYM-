'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmButton,
  TierChip,
} from '@/components/console';
import { formatDate } from '@/lib/format';
import { tierLabel } from '@/app/admin/_lib/tierLabel';
import { AssignClient } from './AssignClient';
import type {
  ClientAssignment,
  CoachSummary,
  CoachTier,
  TierRequest,
} from './CoachRoster';

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
const TIERS: readonly Tier[] = ['starter', 'silver', 'gold', 'elite'];
const COACH_TIERS: readonly CoachTier[] = ['silver', 'gold', 'elite'];
function asTier(t: string): Tier {
  return (TIERS as readonly string[]).includes(t) ? (t as Tier) : 'starter';
}

function formatAssigned(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDate(d);
}

/**
 * Detail pane for one coach: their active clients (each with a two-step "End
 * assignment" ConfirmButton) and the "Assign client" search. Mutations go
 * through the admin API (POST/DELETE /api/admin/assignments) with
 * credentials:'include' so the httpOnly gt_staff cookie authenticates them; on
 * success we call onChanged() which router.refresh()es the server component for
 * fresh data. The keyed remount (key={coach.id} in the parent) resets this
 * component's transient state when the selected coach changes.
 */
export function CoachDetail({
  coach,
  clients,
  tierRequests,
  canAssign,
  canReview,
  onChanged,
}: {
  coach: CoachSummary;
  clients: ClientAssignment[];
  tierRequests: TierRequest[];
  /** Effective `coach.assign` — gates the "Assign client" control. */
  canAssign: boolean;
  /**
   * Effective `coach.application.review` — gates the Edit-coach panel and the
   * tier-request Approve/Reject buttons. Both back onto routes guarded by that
   * permission, so surfacing them to a caller who lacks it is the P1-1 403-trap.
   */
  canReview: boolean;
  onChanged: () => void;
}) {
  // Track the assignment id currently being ended so we can disable just its row.
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit-coach form state, seeded from the current summary.
  const [isActive, setIsActive] = useState(coach.isActive !== false);
  const [coachTier, setCoachTier] = useState<CoachTier>(coach.coachTier);
  const [capacity, setCapacity] = useState(String(coach.capacity));
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Re-seed the edit form whenever the server-provided coach values change (C8).
  // The parent remounts on coach.id change, but an in-pane mutation (approving a
  // tier request, saving an edit) calls onChanged() → router.refresh(), which
  // re-renders THIS same instance with fresh props. Without this the stale local
  // coachTier would be re-sent on the next Save and silently revert the tier that
  // was just approved.
  useEffect(() => {
    setIsActive(coach.isActive !== false);
    setCoachTier(coach.coachTier);
    setCapacity(String(coach.capacity));
  }, [coach.isActive, coach.coachTier, coach.capacity]);

  // Tier-request review state: which request id is mid-decision.
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Ids already assigned to this coach — the search excludes them so you cannot
  // double-assign the same member.
  const assignedUserIds = new Set(clients.map((c) => c.userId));

  const coachLabel = coach.coachName || coach.displayName || coach.email;
  const notAccepting = coach.acceptingClients === false;
  const inactive = coach.isActive === false;
  const fillRatio = coach.capacity > 0 ? clients.length / coach.capacity : 0;
  const full = coach.capacity > 0 && clients.length >= coach.capacity;

  const editDirty =
    isActive !== (coach.isActive !== false) ||
    coachTier !== coach.coachTier ||
    Number(capacity) !== coach.capacity;

  async function saveEdit() {
    const capacityNum = Number(capacity);
    // Match the server's 1..200 bound (C10) so an out-of-range value is caught
    // here with a clear message instead of a generic 400 from the API.
    if (!Number.isInteger(capacityNum) || capacityNum < 1 || capacityNum > 200) {
      setEditError('Capacity must be a whole number from 1 to 200.');
      return;
    }
    // Send only the fields the admin actually changed (C8) — a whole-object PATCH
    // would re-send a stale coachTier and clobber a tier that was upgraded
    // elsewhere between load and save.
    const patch: { isActive?: boolean; coachTier?: CoachTier; capacity?: number } = {};
    if (isActive !== (coach.isActive !== false)) patch.isActive = isActive;
    if (coachTier !== coach.coachTier) patch.coachTier = coachTier;
    if (capacityNum !== coach.capacity) patch.capacity = capacityNum;
    if (Object.keys(patch).length === 0) return; // nothing dirty
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(
        `/api/admin/coaches/${encodeURIComponent(coach.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        setEditError(
          res.status === 403
            ? 'You are not allowed to edit coaches.'
            : 'Could not save these changes. Try again.',
        );
        setSavingEdit(false);
        return;
      }
      setSavingEdit(false);
      onChanged();
    } catch {
      setEditError('Could not reach us just now. Try again.');
      setSavingEdit(false);
    }
  }

  async function decideTierRequest(
    requestId: string,
    action: 'approve' | 'reject',
  ) {
    setDecidingId(requestId);
    setRequestError(null);
    try {
      const res = await fetch(
        `/api/admin/coach-tier-requests/${encodeURIComponent(requestId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        setRequestError(
          res.status === 403
            ? 'You are not allowed to review tier requests.'
            : 'Could not save that decision. Try again.',
        );
        setDecidingId(null);
        return;
      }
      setDecidingId(null);
      onChanged();
    } catch {
      setRequestError('Could not reach us just now. Try again.');
      setDecidingId(null);
    }
  }

  async function endAssignment(assignmentId: string) {
    setEndingId(assignmentId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/assignments/${encodeURIComponent(assignmentId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You are not allowed to change assignments.'
            : res.status === 404
              ? 'That assignment was already ended.'
              : 'Could not end the assignment. Try again.',
        );
        setEndingId(null);
        return;
      }
      setEndingId(null);
      onChanged();
    } catch {
      setError('Could not reach us just now. Try again.');
      setEndingId(null);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Coach"
        action={
          <span style={{ fontSize: 13, color: full ? 'var(--gt-warning)' : 'var(--gt-text-dim)' }}>
            <span className="gt-numeric" style={{ color: 'var(--gt-text)' }}>
              {clients.length}
            </span>
            <span className="gt-numeric">{` of ${coach.capacity}`}</span> places filled
          </span>
        }
      />

      <div style={{ padding: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 19,
              fontWeight: 600,
              margin: 0,
            }}
          >
            {coachLabel}
          </h2>
          <TierChip tier={coach.coachTier} />
          {/* Badges only where something is off. "Accepting and active" is the
              normal state and does not need saying on every coach. */}
          {inactive ? <Badge tone="neutral">Inactive</Badge> : null}
          {notAccepting ? <Badge tone="warning">Not taking clients</Badge> : null}
        </div>
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginBottom: 18 }}>
          {coach.email}
        </div>

        {/* How full they are, at a glance. Semantic tones, never the accent:
            this is a reading, not the page's one action. */}
        <div style={{ marginBottom: 20 }}>
          <div
            aria-hidden
            style={{
              height: 6,
              borderRadius: 'var(--gt-radius-pill)',
              background: 'var(--gt-surface-hover)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.round(fillRatio * 100))}%`,
                height: '100%',
                borderRadius: 'var(--gt-radius-pill)',
                background: full ? 'var(--gt-warning)' : 'var(--gt-success)',
              }}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {full
              ? 'At their limit. New clients need an override.'
              : `Room for ${coach.capacity - clients.length} more.`}
          </div>
        </div>

        {canReview ? (
          <div
            style={{
              marginBottom: 20,
              padding: 14,
              borderRadius: 'var(--gt-radius-sm)',
              border: '1px solid var(--gt-border)',
              background: 'var(--gt-surface-sunken)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--gt-text-faint)',
                fontFamily: 'var(--font-heading)',
                marginBottom: 10,
              }}
            >
              Coach settings
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: '1 1 150px',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Level</span>
                <select
                  className="gt-input"
                  value={coachTier}
                  onChange={(e) => setCoachTier(e.target.value as CoachTier)}
                  disabled={savingEdit}
                  style={{ cursor: 'pointer' }}
                >
                  {COACH_TIERS.map((t) => (
                    <option key={t} value={t}>
                      {tierLabel(t)}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: '1 1 120px',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  Client limit
                </span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  className="gt-input"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  disabled={savingEdit}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: '1 1 120px',
                  justifyContent: 'flex-end',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 48,
                    fontSize: 14,
                    cursor: savingEdit ? 'default' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isActive}
                    disabled={savingEdit}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{
                      accentColor: 'var(--gt-accent-strong)',
                      cursor: 'inherit',
                      width: 18,
                      height: 18,
                    }}
                  />
                  Taking clients
                </span>
              </label>
            </div>

            {editError ? (
              <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 10 }}>
                {editError}
              </div>
            ) : null}

            {editDirty ? (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                {/* Dark, not accent: on this pane the accent belongs to the
                    tier request that somebody is waiting on. */}
                <Button
                  variant="dark"
                  size="sm"
                  disabled={savingEdit}
                  onClick={() => void saveEdit()}
                >
                  {savingEdit ? 'Saving…' : 'Save changes'}
                </Button>
                <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
                  You have unsaved changes.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* A waiting decision is the loudest thing in this pane, because it is
            the only thing here that somebody is waiting on. */}
        {tierRequests.length > 0 ? (
          <div
            style={{
              marginBottom: 20,
              padding: 14,
              borderRadius: 'var(--gt-radius-sm)',
              border: '1px solid color-mix(in srgb, var(--gt-warning) 32%, transparent)',
              background: 'var(--gt-warning-weak)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--gt-warning)',
                fontFamily: 'var(--font-heading)',
                marginBottom: 10,
              }}
            >
              {tierRequests.length === 1
                ? 'Waiting on your decision'
                : `${tierRequests.length} decisions waiting on you`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tierRequests.map((r) => {
                const busy = decidingId === r.id;
                return (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'wrap',
                      padding: '12px 14px',
                      borderRadius: 'var(--gt-radius-sm)',
                      border: '1px solid var(--gt-border)',
                      background: 'var(--gt-card)',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, color: 'var(--gt-text)' }}>
                          Asking to move up to
                        </span>
                        <TierChip tier={r.requestedTier} />
                      </div>
                      {r.note ? (
                        <div
                          style={{
                            fontSize: 14,
                            marginTop: 6,
                            color: 'var(--gt-text)',
                            lineHeight: 1.5,
                          }}
                        >
                          &ldquo;{r.note}&rdquo;
                        </div>
                      ) : null}
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--gt-text-dim)',
                          marginTop: 6,
                        }}
                      >
                        Asked <span className="gt-numeric">{formatDate(r.createdAt)}</span>
                      </div>
                    </div>
                    {canReview ? (
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => void decideTierRequest(r.id, 'reject')}
                        >
                          Turn down
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy}
                          onClick={() => void decideTierRequest(r.id, 'approve')}
                        >
                          {busy ? 'Saving…' : 'Approve'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {requestError ? (
              <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 10 }}>
                {requestError}
              </div>
            ) : null}
          </div>
        ) : null}

        {canAssign ? (
          <AssignClient
            coachId={coach.id}
            excludeUserIds={assignedUserIds}
            notAccepting={notAccepting}
            onAssigned={onChanged}
          />
        ) : null}

        {error ? (
          <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 12,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--gt-text-faint)',
                fontFamily: 'var(--font-heading)',
              }}
            >
              Their clients
            </div>
            {clients.length > 0 ? (
              <span className="gt-numeric" style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                {clients.length}
              </span>
            ) : null}
          </div>

          {clients.length === 0 ? (
            <div
              style={{
                padding: '28px 20px',
                textAlign: 'center',
                border: '1px dashed var(--gt-border-strong)',
                borderRadius: 'var(--gt-radius-sm)',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gt-text)' }}>
                No clients yet
              </div>
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 4 }}>
                {canAssign
                  ? 'Search above to give this coach their first client.'
                  : 'Members assigned to this coach will show up here.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {clients.map((c) => {
                const busy = endingId === c.assignmentId;
                const assigned = formatAssigned(c.assignedAt);
                return (
                  <div
                    key={c.assignmentId}
                    className="gt-inbox-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 'var(--gt-radius-sm)',
                      border: '1px solid var(--gt-border)',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-heading)',
                            fontWeight: 600,
                            fontSize: 15,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.displayName || c.email}
                        </span>
                        <TierChip tier={asTier(c.tier)} />
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'var(--gt-text-dim)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.email}
                        {assigned ? (
                          <>
                            {' · since '}
                            <span className="gt-numeric">{assigned}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <ConfirmButton
                        size="sm"
                        label="End"
                        confirmLabel="Confirm end"
                        busyLabel="Ending…"
                        busy={busy}
                        onConfirm={() => endAssignment(c.assignmentId)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
