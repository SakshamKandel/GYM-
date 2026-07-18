'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, SearchField, TierChip } from '@/components/console';

interface MemberHit {
  id: string;
  email: string;
  displayName: string;
  tier: string;
}

type Tier = 'starter' | 'silver' | 'gold' | 'elite';
const TIERS: readonly Tier[] = ['starter', 'silver', 'gold', 'elite'];
function asTier(t: string): Tier {
  return (TIERS as readonly string[]).includes(t) ? (t as Tier) : 'starter';
}

/**
 * "Assign client" control. Type an email fragment → debounced search against
 * GET /api/admin/members?q= → pick a result → POST /api/admin/assignments
 * { coachId, userId }. Members already assigned to this coach are filtered out
 * (excludeUserIds) so you cannot double-assign. All fetches send
 * credentials:'include' so the httpOnly gt_staff cookie authenticates them.
 * On a successful assign we clear the box and call onAssigned() (parent
 * router.refresh()es for fresh data). No new deps — debounce is a bare timer.
 */
export function AssignClient({
  coachId,
  excludeUserIds,
  notAccepting = false,
  onAssigned,
}: {
  coachId: string;
  excludeUserIds: Set<string>;
  notAccepting?: boolean;
  onAssigned: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MemberHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When the server refuses on capacity/inactive (409), remember which member so
  // the admin can retry with force:true via an "Assign anyway" affordance (C9).
  const [forceTarget, setForceTarget] = useState<{ userId: string; reason: 'full' | 'inactive' } | null>(null);
  // Guards against out-of-order responses clobbering a newer query.
  const reqSeq = useRef(0);

  const trimmed = q.trim();

  useEffect(() => {
    // A new query invalidates any pending "assign anyway" override.
    setForceTarget(null);
    if (trimmed.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/members?q=${encodeURIComponent(trimmed)}`,
          { credentials: 'include' },
        );
        if (seq !== reqSeq.current) return; // a newer query superseded this one
        if (!res.ok) {
          setError('Could not search members.');
          setResults([]);
          setSearching(false);
          return;
        }
        const data = (await res.json()) as { members?: MemberHit[] };
        if (seq !== reqSeq.current) return;
        setError(null);
        setResults(data.members ?? []);
        setSearching(false);
      } catch {
        if (seq !== reqSeq.current) return;
        setError('Network error.');
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [trimmed]);

  async function assign(userId: string, force = false) {
    setAssigningId(userId);
    setError(null);
    if (!force) setForceTarget(null);
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(force ? { coachId, userId, force: true } : { coachId, userId }),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code = typeof data.error === 'string' ? data.error : null;
        } catch {
          code = null;
        }
        // Capacity / inactive refusals are recoverable — surface an override
        // rather than a dead-end error (C9).
        if (res.status === 409 && (code === 'full' || code === 'inactive')) {
          setForceTarget({ userId, reason: code });
          setError(
            code === 'full'
              ? 'This coach is at capacity.'
              : 'This coach is marked inactive.',
          );
          setAssigningId(null);
          return;
        }
        let msg = 'Could not assign this member. Try again.';
        if (res.status === 403) msg = 'You are not allowed to assign clients.';
        else if (res.status === 404) msg = 'That member no longer exists.';
        else if (res.status === 400) msg = 'That account is not a coach.';
        setError(msg);
        setAssigningId(null);
        return;
      }
      // Reset the search and let the parent refetch the roster + client list.
      setAssigningId(null);
      setForceTarget(null);
      setQ('');
      setResults([]);
      reqSeq.current++;
      onAssigned();
    } catch {
      setError('Network error.');
      setAssigningId(null);
    }
  }

  const visible = results.filter((m) => !excludeUserIds.has(m.id));

  return (
    <div>
      <label
        htmlFor="assign-search"
        style={{
          fontSize: 12,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
          fontFamily: 'var(--font-heading)',
          display: 'block',
          marginBottom: 6,
        }}
      >
        Assign a client
      </label>

      <SearchField
        id="assign-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search members by email…"
        autoComplete="off"
      />

      {notAccepting ? (
        <div style={{ fontSize: 12, color: 'var(--gt-warning)', marginTop: 6 }}>
          This coach is marked as not accepting new clients — assign only if
          intentional.
        </div>
      ) : null}

      {error ? (
        <div style={{ color: 'var(--gt-danger)', fontSize: 13, marginTop: 8 }}>{error}</div>
      ) : null}

      {forceTarget ? (
        <div style={{ marginTop: 8 }}>
          <Button
            variant="ghost"
            size="sm"
            disabled={assigningId != null}
            onClick={() => assign(forceTarget.userId, true)}
          >
            {assigningId === forceTarget.userId ? 'Assigning…' : 'Assign anyway'}
          </Button>
        </div>
      ) : null}

      {trimmed.length > 0 ? (
        <div
          style={{
            marginTop: 8,
            border: '1px solid var(--gt-border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {searching ? (
            <div
              style={{
                padding: '12px 14px',
                fontSize: 13,
                color: 'var(--gt-text-dim)',
              }}
            >
              Searching…
            </div>
          ) : visible.length === 0 ? (
            <div
              style={{
                padding: '12px 14px',
                fontSize: 13,
                color: 'var(--gt-text-dim)',
              }}
            >
              {results.length > 0
                ? 'All matches are already assigned to this coach.'
                : 'No members match.'}
            </div>
          ) : (
            visible.map((m, i) => {
              const busy = assigningId === m.id;
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--gt-border)',
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
                        {m.displayName || m.email}
                      </span>
                      <TierChip tier={asTier(m.tier)} />
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
                  <div style={{ flexShrink: 0 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => assign(m.id)}
                      disabled={busy}
                    >
                      {busy ? 'Assigning…' : 'Assign'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
