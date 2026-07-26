'use client';

import { effectiveTier, type Permission } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  PageHeader,
  SearchField,
  SkeletonRows,
  StatusChip,
  TierChip,
  Toolbar,
} from '@/components/console';
import { formatDate } from '@/lib/format';
import { staffRoleLabel } from '@/app/admin/_lib/staffRoleLabel';
import { tierLabel } from '@/app/admin/_lib/tierLabel';
import type { StaffRole } from '@/lib/auth';
import { DownloadCsv } from '../../_components/DownloadCsv';
import { KeyboardRows } from '../../_components/KeyboardRows';
import { useUrlSearch, useUrlState } from '../../_components/useUrlState';
import { MemberDrawer } from './MemberDrawer';
import type { CoachOption, MemberRow, Tier } from './types';

const STATUS_OPTIONS = ['all', 'active', 'suspended'] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

/**
 * Filter choices carry the words an operator reads, never the stored value.
 * Tier names come from the one tier-label map so the directory, the drawer and
 * the app all spell a membership the same way.
 */
const TIER_CHOICES: { value: Tier | 'all'; label: string }[] = [
  { value: 'all', label: 'All tiers' },
  { value: 'starter', label: tierLabel('starter') },
  { value: 'silver', label: tierLabel('silver') },
  { value: 'gold', label: tierLabel('gold') },
  { value: 'elite', label: tierLabel('elite') },
];

const STATUS_CHOICES: { value: StatusOption; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

/** Accepted `?tier=` values. Anything else in the URL falls back to all tiers. */
const TIER_FILTER_KEYS: readonly (Tier | 'all')[] = [
  'all',
  'starter',
  'silver',
  'gold',
  'elite',
];

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
 *
 * Reading order: the person comes first. The primary column is the member's
 * name with their email sitting under it as the quiet identifier, so a row is
 * scanned as "who" rather than as a string of login credentials. Everything
 * after it — membership, status, join date — supports that one answer.
 */
export function MembersDirectory({
  initialMembers,
  initialCursor,
  coaches,
  callerRole,
  callerPermissions,
}: {
  initialMembers: MemberRow[];
  initialCursor: string | null;
  coaches: CoachOption[];
  callerRole: StaffRole;
  /** Caller's effective permission set (override-aware). Forwarded verbatim to
   * MemberDrawer, which gates every control on it (P1-7). */
  callerPermissions: ReadonlySet<Permission>;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  // Search and both filters live in the address bar. Opening a member record
  // is a real navigation, so without this every trip back through the browser
  // dropped the operator at the top of an unfiltered directory — and a
  // directory is the one page nobody wants to search twice. It also makes a
  // narrowed list something you can send to a colleague.
  const [q, setQ] = useUrlSearch('q');
  const [tier, setTier] = useUrlState<Tier | 'all'>('tier', 'all', TIER_FILTER_KEYS);
  const [status, setStatus] = useUrlState<StatusOption>('status', 'all', STATUS_OPTIONS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether the current entries reflect the untouched initial props, so
  // we can skip the first effect run (which would refetch page 1 needlessly).
  const primed = useRef(false);

  // Monotonic request sequence (mirrors StaffManager's GrantRoleModal search
  // guard): a filter change bumps this before firing the new request, and the
  // response only commits if it's still the newest one in flight. Without
  // this a slow response for an earlier filter/search can land AFTER a faster
  // response for a newer one and clobber both the list and the cursor.
  const reqSeq = useRef(0);

  const fetchPage = useCallback(
    async (opts: {
      q: string;
      tier: Tier | 'all';
      status: StatusOption;
      cursor: string | null;
      append: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (opts.q) qs.set('q', opts.q);
      if (opts.status !== 'all') qs.set('status', opts.status);
      if (opts.tier !== 'all') qs.set('tier', opts.tier);
      if (opts.cursor) qs.set('cursor', opts.cursor);

      const mySeq = ++reqSeq.current;

      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/admin/members?${qs.toString()}`, {
          credentials: 'include',
        });
        if (mySeq !== reqSeq.current) return; // superseded by a newer request
        if (!res.ok) {
          setError(res.status === 403 ? 'Not permitted.' : 'Failed to load members.');
          return;
        }
        const data = (await res.json()) as ApiResponse;
        setMembers((prev) => (opts.append ? [...prev, ...data.members] : data.members));
        setCursor(data.nextCursor);
      } catch {
        if (mySeq !== reqSeq.current) return;
        setError('Could not reach us just now. Try again.');
      } finally {
        if (mySeq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
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

  const filtered = q !== '' || tier !== 'all' || status !== 'all';

  function clearFilters() {
    setQ('');
    setTier('all');
    setStatus('all');
  }

  const columns: Column<MemberRow>[] = [
    {
      key: 'member',
      header: 'Member',
      primary: true,
      render: (r) => (
        <div style={{ minWidth: 0, maxWidth: 320 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 15,
                color: 'var(--gt-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.displayName?.trim() || 'No name yet'}
            </span>
            {/* Staff inside the member list is the exception worth marking. */}
            {r.staffRole != null ? (
              <Badge tone="info">{staffRoleLabel(r.staffRole)}</Badge>
            ) : null}
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
            {r.email}
          </div>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Membership',
      width: 190,
      render: (r) => {
        const lapsed =
          r.tier !== 'starter' &&
          effectiveTier(r.tier, r.tierExpiresAt, new Date()) === 'starter';
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <TierChip tier={r.tier} />
            {lapsed ? <Badge tone="warning">Lapsed</Badge> : null}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (r) => <StatusChip status={r.status} />,
    },
    {
      key: 'joined',
      header: 'Joined',
      numeric: true,
      width: 140,
      render: (r) => (
        <span style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap', fontSize: 13 }}>
          {formatDate(r.createdAt)}
        </span>
      ),
    },
    {
      // The same quiet affordance on every row, so "this opens" is learned once.
      key: 'open',
      header: 'Open',
      headerHidden: true,
      width: 24,
      align: 'right',
      render: () => (
        <span
          aria-hidden
          style={{ color: 'var(--gt-text-faint)', fontSize: 17, lineHeight: 1 }}
        >
          ›
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
  // First paint of a filter change with nothing on screen yet: show the shape
  // of the table rather than an empty frame that reads as "no results".
  const showSkeleton = loading && members.length === 0;

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Find a member, then open them to change their membership, suspend or reactivate the account, or assign a coach."
        action={<DownloadCsv href="/api/admin/exports/members" />}
      />

      <Toolbar
        left={
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <SearchField
              placeholder="Search by name or email"
              aria-label="Search members"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
        right={
          <>
            <FilterSelect
              id="members-filter-tier"
              label="Tier"
              value={tier}
              choices={TIER_CHOICES}
              onChange={(v) => setTier(v as Tier | 'all')}
            />
            <FilterSelect
              id="members-filter-status"
              label="Status"
              value={status}
              choices={STATUS_CHOICES}
              onChange={(v) => setStatus(v as StatusOption)}
            />
          </>
        }
      />

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: '12px 14px',
            borderRadius: 'var(--gt-radius-sm)',
            border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
            background: 'var(--gt-danger-weak)',
            color: 'var(--gt-danger)',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchPage({ q, tier, status, cursor: null, append: false })}
          >
            Try again
          </Button>
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          margin: '0 0 10px',
        }}
      >
        <span style={{ color: 'var(--gt-text-dim)', fontSize: 13 }}>
          {loading ? (
            'Updating the list…'
          ) : (
            <>
              Showing{' '}
              <span className="gt-numeric" style={{ color: 'var(--gt-text)' }}>
                {members.length}
              </span>{' '}
              {members.length === 1 ? 'member' : 'members'}
              {filtered ? ' that match your filters' : ''}
            </>
          )}
        </span>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {showSkeleton ? (
        <SkeletonRows rows={6} cols={4} />
      ) : (
        <KeyboardRows>
          <div
            aria-busy={loading}
            style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 120ms' }}
          >
            <DataTable
              columns={columns}
              rows={members}
              rowKey={(r) => r.id}
              caption="Members"
              selectedKey={openId}
              onRowClick={(r) => setOpenId(r.id)}
              rowAriaLabel={(r) =>
                `Open details for ${r.displayName?.trim() || r.email}`
              }
              emptyTitle={filtered ? 'No members match your filters' : 'No members yet'}
              emptyDescription={
                filtered
                  ? 'Try a shorter search, or widen the tier and status.'
                  : 'New sign-ups appear here straight away.'
              }
              emptyAction={
                filtered ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </div>
        </KeyboardRows>
      )}

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
            {loadingMore ? 'Loading…' : 'Load more members'}
          </Button>
        ) : members.length > 0 ? (
          <span style={{ color: 'var(--gt-text-faint)', fontSize: 13 }}>
            That is everyone.
          </span>
        ) : null}
      </div>

      <MemberDrawer
        memberId={openId}
        fallback={selected}
        coaches={coaches}
        callerRole={callerRole}
        callerPermissions={callerPermissions}
        onClose={() => setOpenId(null)}
        onMutated={onMutated}
      />
    </>
  );
}

/**
 * Small labelled <select> for the filter row. The caption is tied to the
 * control with htmlFor/id (not by wrapping) so the label reads as a caption and
 * the control keeps the shared .gt-input focus, hover and 48px sizing.
 */
function FilterSelect({
  id,
  label,
  value,
  choices,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <label
        htmlFor={id}
        style={{
          fontSize: 12,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-faint)',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
        }}
      >
        {label}
      </label>
      <select
        id={id}
        className="gt-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 'auto',
          padding: '8px 10px',
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
