'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  PageHeader,
  SearchField,
  StatusChip,
  TierChip,
  Toolbar,
} from '@/components/console';
import { staffRoleLabel } from '@/app/admin/_lib/staffRoleLabel';
import type { StaffRole } from '@/lib/auth';
import { MemberDrawer } from './MemberDrawer';
import type { CoachOption, MemberRow, Tier } from './types';

const TIER_OPTIONS: (Tier | 'all')[] = ['all', 'starter', 'silver', 'gold', 'elite'];
const STATUS_OPTIONS = ['all', 'active', 'suspended'] as const;

interface ApiResponse {
  members: MemberRow[];
  nextCursor: string | null;
}

/**
 * Member directory: a searchable, tier/status-filterable table backed by
 * server keyset pagination (GET /api/admin/members?q=&status=&tier=&cursor=,
 * same idiom as the audit log's AuditTable). Seeded with server-rendered
 * `initialMembers`/`initialCursor` (page 1) so the first paint has data with
 * no client round-trip; changing a filter debounces a refetch of page 1,
 * "Load more" appends the next keyset page. The row that opens the drawer is
 * passed by id. On any mutation inside the drawer we router.refresh() so the
 * server-rendered page 1 picks up the new tier/status/coach; the client list
 * also gets a fresh page 1 fetch so an active filter reflects the change too.
 */
export function MembersDirectory({
  initialMembers,
  initialCursor,
  coaches,
  callerRole,
  canSuspend,
  canTier,
  canAssign,
}: {
  initialMembers: MemberRow[];
  initialCursor: string | null;
  coaches: CoachOption[];
  callerRole: StaffRole;
  canSuspend: boolean;
  canTier: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether the current entries reflect the untouched initial props, so
  // we can skip the first effect run (which would refetch page 1 needlessly).
  const primed = useRef(false);

  const fetchPage = useCallback(
    async (opts: {
      q: string;
      tier: Tier | 'all';
      status: (typeof STATUS_OPTIONS)[number];
      cursor: string | null;
      append: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (opts.q) qs.set('q', opts.q);
      if (opts.status !== 'all') qs.set('status', opts.status);
      if (opts.tier !== 'all') qs.set('tier', opts.tier);
      if (opts.cursor) qs.set('cursor', opts.cursor);

      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/admin/members?${qs.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          setError(res.status === 403 ? 'Not permitted.' : 'Failed to load members.');
          return;
        }
        const data = (await res.json()) as ApiResponse;
        setMembers((prev) => (opts.append ? [...prev, ...data.members] : data.members));
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

  // Debounced refetch of page 1 whenever a filter changes. Skips the very
  // first render so the server-seeded page 1 is not immediately clobbered.
  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      return;
    }
    const t = setTimeout(() => {
      void fetchPage({ q, tier, status, cursor: null, append: false });
    }, 300);
    return () => clearTimeout(t);
  }, [q, tier, status, fetchPage]);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    void fetchPage({ q, tier, status, cursor, append: true });
  }, [q, tier, status, cursor, fetchPage]);

  const columns: Column<MemberRow>[] = [
    {
      key: 'email',
      header: 'Email',
      render: (r) => (
        <span style={{ fontWeight: 500 }}>{r.email}</span>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {r.displayName?.trim() ? (
            r.displayName
          ) : (
            <span style={{ color: 'var(--gt-text-dim)' }}>—</span>
          )}
          {r.staffRole != null ? (
            <Badge tone="info">{staffRoleLabel(r.staffRole)}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      render: (r) => <TierChip tier={r.tier} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusChip status={r.status} />,
    },
    {
      key: 'joined',
      header: 'Joined',
      align: 'right',
      render: (r) => (
        <span style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>
          {new Date(r.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ),
    },
  ];

  // A drawer mutation can change the row's tier/status/coach. router.refresh()
  // re-runs the server component so page 1 reflects it; also re-fetch the
  // client's current page 1 so an active filter/search stays in sync (e.g. a
  // status change that would drop the row out of the current status filter).
  function onMutated() {
    router.refresh();
    void fetchPage({ q, tier, status, cursor: null, append: false });
  }

  const selected = openId ? members.find((m) => m.id === openId) ?? null : null;

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Search and filter members, then open a member to change their tier, suspend or reactivate the account, or assign a coach."
      />

      <Toolbar
        left={
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <SearchField
              placeholder="Search by email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
        right={
          <>
            <FilterSelect
              label="Tier"
              value={tier}
              options={TIER_OPTIONS}
              onChange={(v) => setTier(v as Tier | 'all')}
            />
            <FilterSelect
              label="Status"
              value={status}
              options={STATUS_OPTIONS as unknown as string[]}
              onChange={(v) =>
                setStatus(v as (typeof STATUS_OPTIONS)[number])
              }
            />
          </>
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

      <div
        style={{
          color: 'var(--gt-text-dim)',
          fontSize: 13,
          margin: '0 0 10px',
        }}
      >
        {members.length} member{members.length === 1 ? '' : 's'} shown
      </div>

      <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 120ms' }}>
        <DataTable
          columns={columns}
          rows={members}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)}
          empty={
            q || tier !== 'all' || status !== 'all'
              ? 'No members match these filters.'
              : 'No members yet.'
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
        ) : members.length > 0 ? (
          <span style={{ color: 'var(--gt-text-dim)', fontSize: 13 }}>
            End of list — {members.length} member{members.length === 1 ? '' : 's'} shown.
          </span>
        ) : null}
      </div>

      <MemberDrawer
        memberId={openId}
        fallback={selected}
        coaches={coaches}
        callerRole={callerRole}
        canSuspend={canSuspend}
        canTier={canTier}
        canAssign={canAssign}
        onClose={() => setOpenId(null)}
        onMutated={onMutated}
      />
    </>
  );
}

/** Small labeled <select> matching the .gt-input look for the filter row. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 12,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
          fontFamily: 'var(--font-heading)',
        }}
      >
        {label}
      </span>
      <select
        className="gt-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '8px 10px',
          textTransform: 'capitalize',
          cursor: 'pointer',
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === 'all' ? 'All' : o}
          </option>
        ))}
      </select>
    </label>
  );
}
