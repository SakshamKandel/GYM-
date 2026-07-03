'use client';

import { useState } from 'react';
import { Badge, Card, CardHeader, ConfirmButton, TierChip } from '@/components/console';
import { AssignClient } from './AssignClient';
import type { ClientAssignment, CoachSummary } from './CoachRoster';

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
const TIERS: readonly Tier[] = ['starter', 'silver', 'gold', 'elite'];
function asTier(t: string): Tier {
  return (TIERS as readonly string[]).includes(t) ? (t as Tier) : 'starter';
}

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
  onChanged,
}: {
  coach: CoachSummary;
  clients: ClientAssignment[];
  onChanged: () => void;
}) {
  // Track the assignment id currently being ended so we can disable just its row.
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ids already assigned to this coach — the search excludes them so you cannot
  // double-assign the same member.
  const assignedUserIds = new Set(clients.map((c) => c.userId));

  const coachLabel = coach.coachName || coach.displayName || coach.email;
  const notAccepting = coach.acceptingClients === false;
  const inactive = coach.isActive === false;

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

        <AssignClient
          coachId={coach.id}
          excludeUserIds={assignedUserIds}
          notAccepting={notAccepting}
          onAssigned={onChanged}
        />

        {error ? (
          <div style={{ color: '#ff8178', fontSize: 13, marginTop: 12 }}>
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
