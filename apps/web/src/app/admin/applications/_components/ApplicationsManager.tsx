'use client';

import type { CoachCertification } from '@gym/db';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  StatusChip,
} from '@/components/console';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type CoachTier = 'silver' | 'gold' | 'elite';

export interface ApplicationRow {
  id: string;
  accountId: string;
  accountEmail: string;
  accountDisplayName: string;
  displayName: string;
  headline: string;
  bio: string;
  yearsExperience: number;
  specialties: string[];
  certifications: CoachCertification[];
  achievements: string[];
  avatarUrl: string | null;
  status: ApplicationStatus;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const TABS: readonly { key: 'all' | ApplicationStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const COACH_TIERS: readonly CoachTier[] = ['silver', 'gold', 'elite'];

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const STATUS_CHIP: Record<
  ApplicationStatus,
  { status: 'pending' | 'live' | 'ended'; label: string }
> = {
  pending: { status: 'pending', label: 'Pending' },
  approved: { status: 'live', label: 'Approved' },
  rejected: { status: 'ended', label: 'Rejected' },
};

/**
 * Coach-application review queue (SCALE-UP-PLAN §1.4 / §4.2). Server-rendered
 * with the full row set (portfolios are small, so no per-row fetch is needed
 * for the detail panel — everything the drawer shows already came down with
 * the initial load). A status tab filters the table client-side; clicking a
 * row opens a Drawer with the full portfolio (avatar, bio, specialties,
 * certifications, achievements) and, for pending applications, the
 * approve/reject controls. Mutations hit the guarded
 * POST /api/admin/coach-applications/[id] route with credentials:'include';
 * on success we router.refresh() so the server-loaded list (and any
 * newly-generated promo code elsewhere in the console) reflects reality.
 */
export function ApplicationsManager({
  applications,
  canReview,
}: {
  applications: ApplicationRow[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [coachTier, setCoachTier] = useState<CoachTier>('silver');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (tab === 'all') return applications;
    return applications.filter((a) => a.status === tab);
  }, [applications, tab]);

  const selected = applications.find((a) => a.id === selectedId) ?? null;

  function openRow(row: ApplicationRow) {
    setSelectedId(row.id);
    setMode(null);
    setCoachTier('silver');
    setNote('');
    setError(null);
  }

  function closeDrawer() {
    if (busy) return;
    setSelectedId(null);
    setMode(null);
  }

  async function decide(action: 'approve' | 'reject') {
    if (!selected) return;
    if (action === 'reject' && note.trim().length === 0) {
      setError('Add a short note explaining the rejection.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/coach-applications/${encodeURIComponent(selected.id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(
            action === 'approve'
              ? { action, coachTier, reviewNote: note.trim() || undefined }
              : { action, reviewNote: note.trim() },
          ),
        },
      );
      if (!res.ok) {
        let code: string | null = null;
        try {
          const data = (await res.json()) as { error?: unknown };
          code = typeof data.error === 'string' ? data.error : null;
        } catch {
          code = null;
        }
        // Map the specific, non-retryable outcomes the route actually returns
        // (C17) — the old `already_coach` branch was dead code, and
        // target_already_staff / self_review_forbidden used to collapse into a
        // misleading generic "try again".
        let msg: string;
        if (code === 'target_already_staff') {
          msg = 'This account already holds a staff role, so it can’t be approved as a coach.';
        } else if (code === 'self_review_forbidden') {
          msg = 'You can’t review your own application.';
        } else if (res.status === 404) {
          msg = 'This application was already decided by someone else. Refresh to see its current status.';
        } else if (res.status === 403) {
          msg = 'You are not allowed to review applications.';
        } else {
          msg = 'Could not save that decision. Try again.';
        }
        setError(msg);
        setBusy(false);
        return;
      }
      setBusy(false);
      setSelectedId(null);
      setMode(null);
      router.refresh();
    } catch {
      setError('Network error.');
      setBusy(false);
    }
  }

  const columns: Column<ApplicationRow>[] = [
    {
      key: 'applicant',
      header: 'Applicant',
      render: (a) => (
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
            {a.displayName || a.accountDisplayName || a.accountEmail}
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
            {a.accountEmail}
          </div>
        </div>
      ),
    },
    {
      key: 'headline',
      header: 'Headline',
      render: (a) => (
        <span
          style={{
            fontSize: 13,
            color: 'var(--gt-text-dim)',
            display: 'inline-block',
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {a.headline || '—'}
        </span>
      ),
    },
    {
      key: 'years',
      header: 'Years',
      width: 80,
      align: 'right',
      render: (a) => (
        <span className="gt-numeric" style={{ fontSize: 13 }}>
          {a.yearsExperience}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (a) => (
        <StatusChip
          status={STATUS_CHIP[a.status].status}
          label={STATUS_CHIP[a.status].label}
        />
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      width: 110,
      align: 'right',
      render: (a) => (
        <span
          className="gt-numeric"
          style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}
        >
          {DATE_FMT.format(new Date(a.createdAt))}
        </span>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const count =
            t.key === 'all'
              ? applications.length
              : applications.filter((a) => a.status === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '7px 14px',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontSize: 13,
                fontWeight: 600,
                background: active ? 'var(--gt-red)' : 'transparent',
                color: active ? '#fff' : 'var(--gt-text)',
                border: active
                  ? '1px solid var(--gt-red)'
                  : '1px solid var(--gt-border)',
              }}
            >
              {t.label} · {count}
            </button>
          );
        })}
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Coach applications submitted from the app appear here for review."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(a) => a.id}
          onRowClick={openRow}
          empty="No applications in this status."
        />
      )}

      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected?.displayName || 'Application'}
        width={480}
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {selected.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.avatarUrl}
                  alt=""
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '1px solid var(--gt-border)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'var(--gt-bg)',
                    border: '1px solid var(--gt-border)',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    fontSize: 16,
                  }}
                >
                  {selected.displayName}
                </div>
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  {selected.accountEmail}
                </div>
                <div style={{ marginTop: 6 }}>
                  <StatusChip
                    status={STATUS_CHIP[selected.status].status}
                    label={STATUS_CHIP[selected.status].label}
                  />
                </div>
              </div>
            </div>

            <Field label="Headline">{selected.headline || '—'}</Field>
            <Field label="Bio">{selected.bio || '—'}</Field>
            <Field label="Years of experience">{selected.yearsExperience}</Field>

            <Field label="Specialties">
              {selected.specialties.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.specialties.map((s) => (
                    <Badge key={s} tone="info">
                      {s}
                    </Badge>
                  ))}
                </div>
              ) : (
                <Muted>None listed.</Muted>
              )}
            </Field>

            <Field label="Certifications">
              {selected.certifications.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {selected.certifications.map((c, i) => (
                    <li key={`${c.title}-${i}`}>
                      {c.title}
                      {c.issuer ? ` — ${c.issuer}` : ''}
                      {c.year ? ` (${c.year})` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted>None listed.</Muted>
              )}
            </Field>

            <Field label="Achievements">
              {selected.achievements.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {selected.achievements.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : (
                <Muted>None listed.</Muted>
              )}
            </Field>

            <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              Submitted {DATE_FMT.format(new Date(selected.createdAt))}
              {selected.decidedAt
                ? ` · Decided ${DATE_FMT.format(new Date(selected.decidedAt))}`
                : ''}
            </div>

            {selected.reviewNote ? (
              <Field label="Review note">{selected.reviewNote}</Field>
            ) : null}

            {canReview && selected.status === 'pending' ? (
              <div
                style={{
                  paddingTop: 16,
                  borderTop: '1px solid var(--gt-border)',
                }}
              >
                {mode === null ? (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setMode('reject');
                        setError(null);
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setMode('approve');
                        setError(null);
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                ) : mode === 'approve' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                        Starting coach tier
                      </span>
                      <select
                        className="gt-input"
                        value={coachTier}
                        onChange={(e) => setCoachTier(e.target.value as CoachTier)}
                        disabled={busy}
                        style={{ textTransform: 'capitalize', cursor: 'pointer' }}
                      >
                        {COACH_TIERS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <textarea
                      className="gt-input"
                      placeholder="Note (optional)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      maxLength={500}
                      disabled={busy}
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setMode(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => void decide('approve')}
                      >
                        {busy ? 'Approving…' : `Approve as ${coachTier}`}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <textarea
                      className="gt-input"
                      placeholder="Reason for rejection"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      maxLength={500}
                      disabled={busy}
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setMode(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => void decide('reject')}
                      >
                        {busy ? 'Rejecting…' : 'Confirm reject'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {error ? (
              <div style={{ color: '#ff8178', fontSize: 13 }}>{error}</div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--gt-text-dim)',
          fontFamily: 'var(--font-heading)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{children}</div>
  );
}
