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

const REQUEST_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatAssigned(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
      setEditError('Network error.');
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
      setRequestError('Network error.');
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
      setError('Network error.');
      setEndingId(null);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Coach"
        action={
          <span
            className="gt-numeric"
            style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
          >
            {clients.length} active {clients.length === 1 ? 'client' : 'clients'}
          </span>
        }
      />

      <div style={{ padding: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 18,
              fontWeight: 600,
              margin: 0,
            }}
          >
            {coachLabel}
          </h2>
          <TierChip tier={coach.coachTier} />
          {inactive ? <Badge tone="neutral">inactive</Badge> : null}
          {notAccepting ? (
            <Badge tone="warning">not accepting</Badge>
          ) : coach.acceptingClients === true ? (
            <Badge tone="positive">accepting</Badge>
          ) : null}
        </div>
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginBottom: 18 }}>
          {coach.email}
        </div>

        {canReview ? (
          <div
            style={{
              marginBottom: 20,
              padding: 14,
              borderRadius: 10,
              border: '1px solid var(--gt-border)',
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
              Edit coach
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: '1 1 140px',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  Coach tier
                </span>
                <select
                  className="gt-input"
                  value={coachTier}
                  onChange={(e) => setCoachTier(e.target.value as CoachTier)}
                  disabled={savingEdit}
                  style={{ textTransform: 'capitalize', cursor: 'pointer' }}
                >
                  {COACH_TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: '1 1 100px',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                  Capacity
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
                  flex: '1 1 100px',
                  justifyContent: 'flex-end',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    cursor: savingEdit ? 'default' : 'pointer',
                    padding: '9px 0',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isActive}
                    disabled={savingEdit}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ accentColor: 'var(--gt-red)', cursor: 'inherit' }}
                  />
                  Active
                </span>
              </label>
            </div>

            {editError ? (
              <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 10 }}>
                {editError}
              </div>
            ) : null}

            {editDirty ? (
              <div style={{ marginTop: 12 }}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={savingEdit}
                  onClick={() => void saveEdit()}
                >
                  {savingEdit ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tierRequests.length > 0 ? (
          <div
            style={{
              marginBottom: 20,
              padding: 14,
              borderRadius: 10,
              border: '1px solid var(--gt-border)',
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
              Pending tier requests
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
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--gt-border)',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                          Requesting
                        </span>
                        <TierChip tier={r.requestedTier} />
                      </div>
                      {r.note ? (
                        <div
                          style={{
                            fontSize: 13,
                            marginTop: 4,
                            color: 'var(--gt-text)',
                          }}
                        >
                          &ldquo;{r.note}&rdquo;
                        </div>
                      ) : null}
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--gt-text-dim)',
                          marginTop: 4,
                        }}
                      >
                        {REQUEST_DATE_FMT.format(new Date(r.createdAt))}
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
                          Reject
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
              fontSize: 12,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color: 'var(--gt-text-dim)',
              fontFamily: 'var(--font-heading)',
              marginBottom: 10,
            }}
          >
            Active clients
          </div>

          {clients.length === 0 ? (
            <div
              style={{
                fontSize: 14,
                color: 'var(--gt-text-dim)',
                padding: '20px 0',
                textAlign: 'center',
                border: '1px dashed var(--gt-border)',
                borderRadius: 10,
              }}
            >
              No active clients yet. Assign one above.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {clients.map((c) => {
                const busy = endingId === c.assignmentId;
                const assigned = formatAssigned(c.assignedAt);
                return (
                  <div
                    key={c.assignmentId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 10,
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
                            fontSize: 14,
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
                          fontSize: 12,
                          color: 'var(--gt-text-dim)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.email}
                        {assigned ? ` · assigned ${assigned}` : ''}
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
