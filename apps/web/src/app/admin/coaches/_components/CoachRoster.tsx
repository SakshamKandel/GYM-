'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge, EmptyState, SearchField, TierChip } from '@/components/console';
import { CoachDetail } from './CoachDetail';

export type CoachTier = 'silver' | 'gold' | 'elite';

export interface CoachSummary {
  id: string;
  email: string;
  displayName: string;
  coachName: string | null;
  acceptingClients: boolean | null;
  isActive: boolean | null;
  /** Seniority badge (SCALE-UP-PLAN §1.4) — not a money tier. */
  coachTier: CoachTier;
  /** Max active clients this coach will take. */
  capacity: number;
  activeClients: number;
}

export interface ClientAssignment {
  assignmentId: string;
  userId: string;
  email: string;
  displayName: string;
  tier: string;
  assignedAt: string | null;
}

/** A pending coach_tier_requests row awaiting admin decision. */
export interface TierRequest {
  id: string;
  requestedTier: CoachTier;
  note: string;
  createdAt: string;
}

/**
 * Coach roster — a master/detail screen. The left column lists every coach with
 * their active client count and accepting/inactive badges, filterable by a
 * search box. The right column shows the selected coach's active clients plus
 * the "Assign client" control. Both lists are server-rendered snapshots passed
 * in as props; after any mutation (assign / end) the detail pane calls
 * router.refresh() to re-run the server component and pull fresh data, so the
 * server stays the single source of truth (no optimistic client cache).
 */
export function CoachRoster({
  coaches,
  clientsByCoach,
  tierRequestsByCoach,
  canAssign,
  canReview,
}: {
  coaches: CoachSummary[];
  clientsByCoach: Record<string, ClientAssignment[]>;
  tierRequestsByCoach: Record<string, TierRequest[]>;
  /** Effective `coach.assign` — gates the "Assign client" control. */
  canAssign: boolean;
  /** Effective `coach.application.review` — gates the Edit panel + tier decisions. */
  canReview: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  // Persist the selection across router.refresh() (props change, this survives).
  const [selectedId, setSelectedId] = useState<string | null>(
    coaches.length > 0 ? coaches[0].id : null,
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return coaches;
    return coaches.filter((c) =>
      [c.coachName, c.displayName, c.email]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [coaches, query]);

  // Selected coach — prefer the explicit selection, but fall back to the first
  // coach so the detail pane is never empty when coaches exist. Resolve against
  // the FULL list (not the filtered one) so filtering the list doesn't blank the
  // currently-open detail.
  const selected =
    coaches.find((c) => c.id === selectedId) ?? coaches[0] ?? null;

  if (coaches.length === 0) {
    return (
      <EmptyState
        title="No coaches yet"
        description="Grant an account the coach role in Roles & staff to see it here, then assign members to it."
      />
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 340px) 1fr',
        gap: 20,
        alignItems: 'start',
      }}
    >
      {/* Master: coach list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter coaches…"
          aria-label="Filter coaches"
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.length === 0 ? (
            <div
              className="gt-card"
              style={{
                padding: 20,
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--gt-text-dim)',
              }}
            >
              No coaches match &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            filtered.map((c) => {
              const isSelected = c.id === selected?.id;
              const label = c.coachName || c.displayName || c.email;
              const inactive = c.isActive === false;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-pressed={isSelected}
                  className="gt-card"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '13px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    borderLeft: isSelected
                      ? '3px solid var(--gt-red)'
                      : '1px solid var(--gt-border)',
                    background: isSelected
                      ? 'rgba(255,59,48,0.05)'
                      : undefined,
                    color: 'inherit',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 4,
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
                        {label}
                      </span>
                      {inactive ? (
                        <Badge tone="neutral">inactive</Badge>
                      ) : c.acceptingClients === true ? (
                        <Badge tone="positive">open</Badge>
                      ) : c.acceptingClients === false ? (
                        <Badge tone="warning">closed</Badge>
                      ) : null}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 2,
                      }}
                    >
                      <TierChip tier={c.coachTier} />
                      {(tierRequestsByCoach[c.id]?.length ?? 0) > 0 ? (
                        <Badge tone="warning">tier request</Badge>
                      ) : null}
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
                    </div>
                  </div>
                  <span
                    className="gt-numeric"
                    title={`${c.activeClients} active client${c.activeClients === 1 ? '' : 's'}`}
                    style={{
                      fontSize: 15,
                      color: isSelected ? 'var(--gt-text)' : 'var(--gt-text-dim)',
                      flexShrink: 0,
                      minWidth: 20,
                      textAlign: 'right',
                    }}
                  >
                    {c.activeClients}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail: selected coach's clients + assign control */}
      {selected ? (
        <CoachDetail
          key={selected.id}
          coach={selected}
          clients={clientsByCoach[selected.id] ?? []}
          tierRequests={tierRequestsByCoach[selected.id] ?? []}
          canAssign={canAssign}
          canReview={canReview}
          onChanged={() => router.refresh()}
        />
      ) : (
        <div
          className="gt-card"
          style={{ padding: 32, color: 'var(--gt-text-dim)', fontSize: 14 }}
        >
          Select a coach to view their clients.
        </div>
      )}
    </div>
  );
}
