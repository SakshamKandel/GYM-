'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  SearchField,
  SkeletonBar,
  TierChip,
} from '@/components/console';
import { useUrlSearch } from '../../_components/useUrlState';
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
  // In the URL, so opening a coach and coming back keeps the search that found
  // them.
  const [query, setQuery] = useUrlSearch('q');
  // Which coach the operator just clicked. Only meaningful while the navigation
  // that loads their clients is still in flight; once it lands, the server's
  // `selectedCoachId` matches it and this falls back out of use.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();

  function selectCoach(id: string) {
    if (id === selectedCoachId) return;
    setPendingId(id);
    // Carry the rest of the query across. Picking a coach used to rebuild the
    // URL from scratch, which threw away the search that found them — so the
    // list under the cursor reset to every coach on the platform.
    const params = new URLSearchParams(window.location.search);
    params.set('coach', id);
    startNavigation(() => {
      // replace, not push: flipping between coaches shouldn't stack up history
      // entries the operator has to back out of one by one.
      router.replace(`/admin/coaches?${params.toString()}`, { scroll: false });
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
        description="Give an account the coach role in Staff and roles, then come back here to assign members to them."
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
          placeholder="Find a coach"
          aria-label="Find a coach"
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.length === 0 ? (
            <div
              className="gt-card"
              style={{
                padding: '24px 20px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gt-text)' }}>
                No coaches found
              </div>
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 4 }}>
                Nothing matches &ldquo;{query.trim()}&rdquo;.
              </div>
              <div style={{ marginTop: 12 }}>
                <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                  Clear
                </Button>
              </div>
            </div>
          ) : (
            filtered.map((c) => {
              const isSelected = c.id === highlightId;
              const label = c.coachName || c.displayName || c.email;
              const inactive = c.isActive === false;
              const closed = !inactive && c.acceptingClients === false;
              const pendingTier = (tierRequestsByCoach[c.id]?.length ?? 0) > 0;
              const full = c.capacity > 0 && c.activeClients >= c.capacity;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCoach(c.id)}
                  aria-pressed={isSelected}
                  // gt-inbox-row carries the hover this list never had.
                  className="gt-card gt-inbox-row"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '13px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    // The selected coach is the one thing the accent marks in
                    // this column. Both values come from the token layer, not
                    // from a hand-mixed rgba.
                    borderLeft: isSelected
                      ? '3px solid var(--gt-accent)'
                      : '1px solid var(--gt-border)',
                    background: isSelected ? 'var(--gt-accent-weak)' : undefined,
                    color: 'inherit',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-heading)',
                        fontWeight: 600,
                        fontSize: 15,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 13,
                        color: 'var(--gt-text-dim)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.email}
                    </div>
                    {/* Only the exceptions get a badge. A coach quietly doing
                        their job wears nothing, so the one who needs attention
                        is the one you see. */}
                    <div
                      style={{
                        marginTop: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <TierChip tier={c.coachTier} />
                      {pendingTier ? <Badge tone="warning">Wants a review</Badge> : null}
                      {inactive ? <Badge tone="neutral">Inactive</Badge> : null}
                      {closed ? <Badge tone="warning">Not taking clients</Badge> : null}
                    </div>
                  </div>
                  <span
                    title={`${c.activeClients} of ${c.capacity} places filled`}
                    style={{
                      flexShrink: 0,
                      textAlign: 'right',
                      fontSize: 13,
                      color: full ? 'var(--gt-warning)' : 'var(--gt-text-dim)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span className="gt-numeric" style={{ fontSize: 16, color: 'var(--gt-text)' }}>
                      {c.activeClients}
                    </span>
                    <span className="gt-numeric">{` / ${c.capacity}`}</span>
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
        // Shaped like the pane it replaces, so nothing jumps when it lands.
        <div className="gt-card" aria-busy="true" role="status" style={{ padding: 18 }}>
          <span className="gt-sr-only">Loading this coach</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SkeletonBar w="42%" h={20} />
            <SkeletonBar w="58%" />
            <SkeletonBar w="100%" h={64} />
            <SkeletonBar w="100%" h={52} />
            <SkeletonBar w="100%" h={52} />
          </div>
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
        <div className="gt-card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gt-text)' }}>
            Pick a coach
          </div>
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 6 }}>
            Choose someone on the left to see their clients and manage them.
          </div>
        </div>
      )}
    </div>
  );
}
