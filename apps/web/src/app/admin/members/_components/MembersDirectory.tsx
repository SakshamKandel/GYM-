'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
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

/**
 * Member directory: a searchable, tier/status-filterable table. Filtering is
 * client-side over the server-loaded rows (capped at 200); the row that opens
 * the drawer is passed by id. On any mutation inside the drawer we
 * router.refresh() so the table reflects the new tier/status/coach.
 */
export function MembersDirectory({
  members,
  coaches,
  callerRole,
  canSuspend,
  canTier,
  canAssign,
}: {
  members: MemberRow[];
  coaches: CoachOption[];
  callerRole: StaffRole;
  canSuspend: boolean;
  canTier: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return members.filter((m) => {
      if (tier !== 'all' && m.tier !== tier) return false;
      if (status !== 'all' && m.status !== status) return false;
      if (needle) {
        const hay = `${m.email} ${m.displayName}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [members, q, tier, status]);

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

  function onMutated() {
    router.refresh();
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
              placeholder="Search by email or name…"
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

      <div
        style={{
          color: 'var(--gt-text-dim)',
          fontSize: 13,
          margin: '0 0 10px',
        }}
      >
        {filtered.length} of {members.length} member
        {members.length === 1 ? '' : 's'}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        empty={
          members.length === 0
            ? 'No members yet.'
            : 'No members match these filters.'
        }
      />

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
