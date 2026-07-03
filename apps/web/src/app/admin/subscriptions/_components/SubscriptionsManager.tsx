'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Modal,
  SearchField,
  TierChip,
} from '@/components/console';

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

export interface MemberRow {
  id: string;
  email: string;
  displayName: string;
  tier: Tier;
  status: 'active' | 'suspended';
}

const TIERS: readonly Tier[] = ['starter', 'silver', 'gold', 'elite'];

/**
 * Members table + tier-override control. Filtering is client-side over the
 * server-rendered roster (the page already caps the roster; a busy install can
 * pre-narrow server-side later). "Change tier" opens a modal to pick a new tier
 * and optionally record a reason, then POSTs to /api/admin/subscriptions with
 * credentials:'include' so the httpOnly gt_staff cookie authenticates it. On
 * success we router.refresh() so both the roster tier chip and the change log
 * below reflect the override without a full reload.
 */
export function SubscriptionsManager({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [nextTier, setNextTier] = useState<Tier>('starter');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q),
    );
  }, [members, filter]);

  function openEdit(m: MemberRow) {
    setEditing(m);
    setNextTier(m.tier);
    setReason('');
    setError(null);
  }

  function closeEdit() {
    if (saving) return;
    setEditing(null);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountId: editing.id,
          tier: nextTier,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        let msg = 'Could not update this tier. Try again.';
        if (res.status === 403) msg = 'You are not allowed to override tiers.';
        else if (res.status === 404) msg = 'That member no longer exists.';
        setError(msg);
        setSaving(false);
        return;
      }
      setSaving(false);
      setEditing(null);
      router.refresh();
    } catch {
      setError('Network error.');
      setSaving(false);
    }
  }

  const columns: Column<MemberRow>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (m) => (
        <div style={{ minWidth: 0 }}>
          <div
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
      ),
    },
    {
      key: 'status',
      header: 'Account',
      render: (m) => (
        <span
          style={{
            fontSize: 12,
            color:
              m.status === 'suspended' ? '#ff8178' : 'var(--gt-text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontFamily: 'var(--font-numeric)',
          }}
        >
          {m.status}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Current tier',
      render: (m) => <TierChip tier={m.tier} />,
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (m) => (
        <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
          Change tier
        </Button>
      ),
    },
  ];

  const changed = editing ? nextTier !== editing.tier : false;

  return (
    <>
      <div style={{ maxWidth: 320, marginBottom: 14 }}>
        <SearchField
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or email…"
          aria-label="Filter members"
        />
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Members appear here once accounts exist. You can override any member's subscription tier from this table."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          empty="No members match your filter."
        />
      )}

      <Modal
        open={editing !== null}
        onClose={closeEdit}
        title="Override subscription tier"
        footer={
          <>
            <Button variant="ghost" onClick={closeEdit} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={saving || !changed}
            >
              {saving ? 'Saving…' : 'Apply override'}
            </Button>
          </>
        }
      >
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {editing.displayName || editing.email}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                {editing.email}
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                  marginBottom: 8,
                }}
              >
                New tier
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TIERS.map((t) => {
                  const selected = nextTier === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNextTier(t)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-numeric)',
                        fontSize: 13,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        background: selected
                          ? 'var(--gt-red)'
                          : 'transparent',
                        color: selected ? '#fff' : 'var(--gt-text)',
                        border: selected
                          ? '1px solid var(--gt-red)'
                          : '1px solid var(--gt-border)',
                        transition: 'background 120ms, border-color 120ms',
                      }}
                    >
                      {t}
                      {t === editing.tier ? ' (current)' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  color: 'var(--gt-text-dim)',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                Reason (optional)
              </span>
              <textarea
                className="gt-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. comped for support escalation"
                rows={3}
                maxLength={500}
                style={{ resize: 'vertical', fontFamily: 'inherit' }}
              />
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                Recorded in the audit log alongside this override.
              </span>
            </label>

            {error ? (
              <div style={{ color: 'var(--gt-red)', fontSize: 13 }}>{error}</div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
