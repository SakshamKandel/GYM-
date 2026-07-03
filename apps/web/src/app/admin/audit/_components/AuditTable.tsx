'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  SearchField,
  Toolbar,
  type Column,
} from '@/components/console';

/** One audit_log row as returned by GET /api/admin/audit. */
export interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: string; // ISO
  actorId: string | null;
  actorEmail: string | null;
}

interface ApiResponse {
  entries: AuditEntry[];
  nextCursor: string | null;
}

/** Groups actions by their dotted prefix for a semantic tone on the chip. */
function toneForAction(action: string): 'neutral' | 'warning' | 'critical' | 'info' | 'positive' {
  if (action.includes('suspend') || action.includes('delete') || action.includes('revoke')) {
    return 'critical';
  }
  if (action.includes('subscription') || action.includes('tier') || action.includes('grant')) {
    return 'warning';
  }
  if (action.startsWith('coach')) return 'info';
  if (action.startsWith('content')) return 'positive';
  return 'neutral';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Renders the free-form meta jsonb compactly; empty object shows a dim dash. */
function MetaCell({ meta }: { meta: Record<string, unknown> }) {
  const keys = meta ? Object.keys(meta) : [];
  if (keys.length === 0) {
    return <span style={{ color: 'var(--gt-text-dim)' }}>—</span>;
  }
  return (
    <code
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        color: 'var(--gt-text-dim)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        display: 'block',
        maxWidth: 320,
      }}
    >
      {keys
        .map((k) => `${k}: ${formatValue(meta[k])}`)
        .join('\n')}
    </code>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Interactive audit-log viewer. Seeded with server-rendered `initialEntries`
 * and `initialCursor` (page 1) so the first paint has data without a client
 * round-trip; subsequent filters and "Load more" refetch the guarded API.
 *
 * `actorQuery` filters by actor email substring (debounced); `action` is an
 * exact filter from the distinct-action dropdown. Changing either resets the
 * keyset and refetches page 1. "Load more" appends the next keyset page.
 */
export function AuditTable({
  initialEntries,
  initialCursor,
  actions,
}: {
  initialEntries: AuditEntry[];
  initialCursor: string | null;
  actions: string[];
}) {
  const [entries, setEntries] = useState<AuditEntry[]>(initialEntries);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether the current entries reflect the untouched initial props, so
  // we can skip the first effect run (which would refetch page 1 needlessly).
  const primed = useRef(false);

  const fetchPage = useCallback(
    async (opts: { action: string; actor: string; cursor: string | null; append: boolean }) => {
      const qs = new URLSearchParams();
      if (opts.action) qs.set('action', opts.action);
      if (opts.actor) qs.set('actor', opts.actor);
      if (opts.cursor) qs.set('cursor', opts.cursor);

      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/admin/audit?${qs.toString()}`, {
          credentials: 'same-origin',
        });
        if (!res.ok) {
          setError(res.status === 403 ? 'Not permitted.' : 'Failed to load audit log.');
          return;
        }
        const data = (await res.json()) as ApiResponse;
        setEntries((prev) => (opts.append ? [...prev, ...data.entries] : data.entries));
        setCursor(data.nextCursor);
      } catch {
        setError('Network error.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  // Debounced refetch of page 1 whenever a filter changes. Skips the very first
  // render so the server-seeded page 1 is not immediately clobbered.
  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      return;
    }
    const t = setTimeout(() => {
      void fetchPage({ action, actor, cursor: null, append: false });
    }, 300);
    return () => clearTimeout(t);
  }, [action, actor, fetchPage]);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    void fetchPage({ action, actor, cursor, append: true });
  }, [action, actor, cursor, fetchPage]);

  const columns: Column<AuditEntry>[] = [
    {
      key: 'time',
      header: 'Time',
      width: 190,
      render: (r) => (
        <span
          style={{
            fontFamily: 'var(--font-numeric)',
            fontSize: 13,
            color: 'var(--gt-text)',
            whiteSpace: 'nowrap',
          }}
        >
          {fmtTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (r) =>
        r.actorEmail ? (
          <span style={{ fontSize: 13 }}>{r.actorEmail}</span>
        ) : (
          <span style={{ color: 'var(--gt-text-dim)', fontSize: 13 }}>
            {r.actorId ? 'deleted account' : 'system'}
          </span>
        ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (r) => <Badge tone={toneForAction(r.action)}>{r.action}</Badge>,
    },
    {
      key: 'target',
      header: 'Target',
      render: (r) => (
        <span style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--gt-text-dim)' }}>{r.targetType}</span>
          {r.targetId ? (
            <>
              {' '}
              <code
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                }}
              >
                {r.targetId}
              </code>
            </>
          ) : null}
        </span>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      width: 130,
      render: (r) =>
        r.ip ? (
          <code
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              color: 'var(--gt-text-dim)',
            }}
          >
            {r.ip}
          </code>
        ) : (
          <span style={{ color: 'var(--gt-text-dim)' }}>—</span>
        ),
    },
    {
      key: 'meta',
      header: 'Meta',
      render: (r) => <MetaCell meta={r.meta} />,
    },
  ];

  return (
    <div>
      <Toolbar
        left={
          <SearchField
            placeholder="Filter by actor email…"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            aria-label="Filter by actor email"
          />
        }
        right={
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                color: 'var(--gt-text-dim)',
                fontFamily: 'var(--font-heading)',
              }}
            >
              Action
            </span>
            <select
              className="gt-input"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              style={{ minWidth: 200 }}
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(255,107,96,0.30)',
            background: 'rgba(255,107,96,0.10)',
            color: '#ff8178',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 120ms' }}>
        <DataTable
          columns={columns}
          rows={entries}
          rowKey={(r) => r.id}
          empty={
            action || actor
              ? 'No events match the current filters.'
              : 'Staff actions will appear here as they happen.'
          }
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          marginTop: 16,
        }}
      >
        {cursor ? (
          <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        ) : entries.length > 0 ? (
          <span style={{ color: 'var(--gt-text-dim)', fontSize: 13 }}>
            End of log — {entries.length} event{entries.length === 1 ? '' : 's'} shown.
          </span>
        ) : null}
      </div>
    </div>
  );
}
