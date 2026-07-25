'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
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
 * the "Assign client" control.
 *
 * Selection lives in the URL (`?coach=<id>`), not in local state, because only
 * the SELECTED coach's client list is loaded. Shipping every coach's clients up
 * front put every coached member's name, email, and tier into the page payload
 * on every visit; now the roster carries counts only and picking a coach
 * re-runs the server component for just that one list. Everything else is
 * unchanged: after any mutation the detail pane calls router.refresh() and the
 * server stays the single source of truth (no optimistic client cache).
 */
export function CoachRoster({
  coaches,
  selectedCoachId,
  selectedClients,
  tierRequestsByCoach,
  canAssign,
  canReview,
}: {
  coaches: CoachSummary[];
  /** Server-resolved selection (from `?coach=`, falling back to the first coach). */
  selectedCoachId: string | null;
  /** Active clients for `selectedCoachId` ONLY — never the whole platform. */
  selectedClients: ClientAssignment[];
  tierRequestsByCoach: Record<string, TierRequest[]>;
  /** Effective `coach.assign` — gates the "Assign client" control. */
  canAssign: boolean;
  /** Effective `coach.application.review` — gates the Edit panel + tier decisions. */
  canReview: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  // Which coach the operator just clicked. Only meaningful while the navigation
  // that loads their clients is still in flight; once it lands, the server's
  // `selectedCoachId` matches it and this falls back out of use.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();

  function selectCoach(id: string) {
    if (id === selectedCoachId) return;
    setPendingId(id);
    startNavigation(() => {
      // replace, not push: flipping between coaches shouldn't stack up history
      // entries the operator has to back out of one by one.
      router.replace(`/admin/coaches?coach=${encodeURIComponent(id)}`, { scroll: false });
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return coaches;
    return coaches.filter((c) =>
      [c.coachName, c.displayName, c.email]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [coaches, query]);

  // Selected coach — resolved against the FULL list (not the filtered one) so
  // filtering the list doesn't blank the currently-open detail. The server
  // already applied the first-coach fallback.
  const selected = coaches.find((c) => c.id === selectedCoachId) ?? null;
  // The row to highlight: the one just clicked while its clients load, then the
  // server's selection. Keeps the click feeling instant even though the list it
  // opens comes from the server.
  const highlightId = navigating && pendingId ? pendingId : selectedCoachId;
  // True while the pane's contents belong to a DIFFERENT coach than the one now
  // highlighted — showing the previous coach's clients under the new coach's
  // name would be worse than showing nothing.
  const detailLoading = navigating && pendingId != null && pendingId !== selectedCoachId;

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
              const isSelected = c.id === highlightId;
              const label = c.coachName || c.displayName || c.email;
              const inactive = c.isActive === false;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCoach(c.id)}
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

      {/* Detail: selected coach's clients + assign control. Loaded on demand
          for this coach alone, so switching coaches is a server round trip. */}
      {detailLoading ? (
        <div
          className="gt-card"
          aria-busy="true"
          style={{ padding: 32, color: 'var(--gt-text-dim)', fontSize: 14 }}
        >
          Loading this coach&rsquo;s clients…
        </div>
      ) : selected ? (
        <CoachDetail
          key={selected.id}
          coach={selected}
          clients={selectedClients}
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
