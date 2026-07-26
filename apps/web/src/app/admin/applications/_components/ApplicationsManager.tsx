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
  SearchField,
  StatusChip,
  Toolbar,
} from '@/components/console';
import { formatDate } from '@/lib/format';
import { tierLabel } from '@/app/admin/_lib/tierLabel';
import { ActionFeedback, useActionFeedback } from '../../_components/ActionFeedback';
import { KeyboardRows } from '../../_components/KeyboardRows';
import { MemberLink } from '../../_components/MemberLink';
import { QueueTabs } from '../../_components/QueueTabs';
import { useUrlSearch, useUrlState } from '../../_components/useUrlState';

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

const TAB_KEYS: readonly (typeof TABS)[number]['key'][] = [
  'all',
  'pending',
  'approved',
  'rejected',
];

const COACH_TIERS: readonly CoachTier[] = ['silver', 'gold', 'elite'];

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
  canViewMembers,
}: {
  applications: ApplicationRow[];
  canReview: boolean;
  /** Viewer holds `members.read`, so applicant names can link to the record. */
  canViewMembers: boolean;
}) {
  const router = useRouter();
  // The tab and the search sit in the URL, so opening an applicant's member
  // record and coming back returns to the same shortlist rather than to
  // "Pending, unfiltered" — which is where the reviewer started an hour ago.
  const [tab, setTab] = useUrlState<(typeof TABS)[number]['key']>('tab', 'pending', TAB_KEYS);
  const [query, setQuery] = useUrlSearch('q');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [coachTier, setCoachTier] = useState<CoachTier>('silver');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decided = useActionFeedback();

  const filtered = useMemo(() => {
    const inTab = tab === 'all' ? applications : applications.filter((a) => a.status === tab);
    const q = query.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((a) =>
      [a.displayName, a.accountDisplayName, a.accountEmail, a.headline, ...a.specialties]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [applications, tab, query]);

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
      // Say what happened on the page the reviewer is thrown back to. The
      // drawer closing was the only signal a decision had landed, and a drawer
      // also closes when you press Escape or miss the panel with a click.
      decided.succeed(
        action === 'approve'
          ? `${selected.displayName} is now a ${tierLabel(coachTier)} coach`
          : `${selected.displayName}'s application was turned down`,
      );
      setSelectedId(null);
      setMode(null);
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
      setBusy(false);
    }
  }

  // The row carries the case, not just the name: the pitch, what they coach and
  // how long they have done it. A reviewer should be able to shortlist from the
  // table and open the drawer only to confirm, rather than opening every row to
  // find out what it is about.
  const columns: Column<ApplicationRow>[] = [
    {
      key: 'applicant',
      header: 'Applicant',
      primary: true,
      render: (a) => (
        <div style={{ minWidth: 0, maxWidth: 230 }}>
          <MemberLink
            id={a.accountId}
            name={a.displayName || a.accountDisplayName}
            email={a.accountEmail}
            canView={canViewMembers}
          />
          <div
            style={{
              marginTop: 2,
              fontSize: 13,
              fontWeight: 400,
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
      header: 'What they say they do',
      render: (a) => (
        <div style={{ minWidth: 0, maxWidth: 320 }}>
          <div
            title={a.headline || undefined}
            style={{
              fontSize: 14,
              color: a.headline ? 'var(--gt-text)' : 'var(--gt-text-faint)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {a.headline || 'No headline written'}
          </div>
          {a.specialties.length > 0 ? (
            <div
              style={{
                marginTop: 5,
                display: 'flex',
                gap: 4,
                flexWrap: 'nowrap',
                overflow: 'hidden',
              }}
            >
              {a.specialties.slice(0, 2).map((s) => (
                <Badge key={s} tone="neutral">
                  {s}
                </Badge>
              ))}
              {a.specialties.length > 2 ? (
                <Badge tone="neutral">{`+${a.specialties.length - 2}`}</Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'experience',
      header: 'Experience',
      numeric: true,
      width: 130,
      render: (a) => (
        <div style={{ lineHeight: 1.35 }}>
          <div style={{ fontSize: 14, color: 'var(--gt-text)' }}>
            {a.yearsExperience} {a.yearsExperience === 1 ? 'year' : 'years'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
            {a.certifications.length === 0
              ? 'No certificates'
              : `${a.certifications.length} ${
                  a.certifications.length === 1 ? 'certificate' : 'certificates'
                }`}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 116,
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
      numeric: true,
      width: 120,
      render: (a) => (
        <span style={{ fontSize: 13, color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>
          {formatDate(a.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <Toolbar
        left={
          <QueueTabs
            label="Filter coach applications"
            tabs={TABS.map((t) => ({
              key: t.key,
              label: t.label,
              count:
                t.key === 'all'
                  ? applications.length
                  : applications.filter((a) => a.status === t.key).length,
            }))}
            value={tab}
            onChange={setTab}
          />
        }
        right={
          <div style={{ width: 280, maxWidth: '100%' }}>
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or specialty"
              aria-label="Search coach applications"
            />
          </div>
        }
      />

      {/* Reserves its line so a decision landing here can't nudge the table. */}
      <div style={{ marginBottom: 8 }}>
        <ActionFeedback feedback={decided.feedback} reserveSpace />
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Coach applications sent from the app arrive here for review."
        />
      ) : (
        <KeyboardRows>
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(a) => a.id}
            caption="Coach applications"
            selectedKey={selectedId}
            onRowClick={openRow}
            rowAriaLabel={(a) => `Review the application from ${a.displayName}`}
            emptyTitle={
              query.trim() ? 'Nothing matches that search' : 'Nothing in this list'
            }
            emptyDescription={
              query.trim()
                ? 'Try part of a name, an email, or a specialty.'
                : 'Switch tabs to see applications in another state.'
            }
            emptyAction={
              query.trim() ? (
                <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : undefined
            }
          />
        </KeyboardRows>
      )}

      {/* The decision lives in the pinned footer, not at the bottom of the
          portfolio. A reviewer can read as much of the evidence as they need
          and act without scrolling back, and the two buttons are in the same
          place on every application. */}
      <Drawer
        open={selected != null}
        onClose={closeDrawer}
        title={selected?.displayName || 'Application'}
        width={520}
        footer={
          selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
              {error ? (
                <div
                  role="alert"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--gt-radius-sm)',
                    border: '1px solid color-mix(in srgb, var(--gt-danger) 32%, transparent)',
                    background: 'var(--gt-danger-weak)',
                    color: 'var(--gt-danger)',
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              ) : null}

              {selected.status !== 'pending' ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  {selected.status === 'approved' ? 'Approved' : 'Turned down'}
                  {selected.decidedAt ? ` on ${formatDate(selected.decidedAt)}` : ''}. There
                  is nothing left to decide here.
                </div>
              ) : !canReview ? (
                <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  You can read applications but not decide them.
                </div>
              ) : mode === null ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{ fontSize: 12, color: 'var(--gt-text-faint)', maxWidth: '34ch' }}
                  >
                    Approving grants the coach role and publishes their profile.
                  </span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setMode('reject');
                        setError(null);
                      }}
                    >
                      Turn down
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
                </div>
              ) : mode === 'approve' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                      Starting coach level
                    </span>
                    <select
                      className="gt-input"
                      value={coachTier}
                      onChange={(e) => setCoachTier(e.target.value as CoachTier)}
                      disabled={busy}
                      style={{ cursor: 'pointer' }}
                    >
                      {COACH_TIERS.map((t) => (
                        <option key={t} value={t}>
                          {tierLabel(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <textarea
                    className="gt-input"
                    placeholder="Add a note for the record (optional)"
                    aria-label="Note for the record"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    disabled={busy}
                    style={{ resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" disabled={busy} onClick={() => setMode(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => void decide('approve')}
                    >
                      {busy ? 'Approving…' : `Approve as ${tierLabel(coachTier)}`}
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <textarea
                    className="gt-input"
                    placeholder="Tell them why, in a sentence"
                    aria-label="Reason for turning this application down"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    disabled={busy}
                    style={{ resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" disabled={busy} onClick={() => setMode(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void decide('reject')}
                    >
                      {busy ? 'Turning down…' : 'Turn down'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null
        }
      >
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {selected.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.avatarUrl}
                  alt=""
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 'var(--gt-radius-pill)',
                    objectFit: 'cover',
                    border: '1px solid var(--gt-border)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  aria-hidden
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 'var(--gt-radius-pill)',
                    background: 'var(--gt-surface-sunken)',
                    border: '1px solid var(--gt-border)',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    fontSize: 22,
                    color: 'var(--gt-text-faint)',
                  }}
                >
                  {(selected.displayName || selected.accountEmail).charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    fontSize: 17,
                  }}
                >
                  {selected.displayName}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--gt-text-dim)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {selected.accountEmail}
                </div>
                <div style={{ marginTop: 8 }}>
                  <StatusChip
                    status={STATUS_CHIP[selected.status].status}
                    label={STATUS_CHIP[selected.status].label}
                  />
                </div>
              </div>
            </div>

            {/* The pitch, in their own words, at the size it deserves. */}
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--font-heading)',
                fontSize: 16,
                lineHeight: 1.45,
                color: selected.headline ? 'var(--gt-text)' : 'var(--gt-text-faint)',
              }}
            >
              {selected.headline || 'No headline written.'}
            </p>

            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                gap: '8px 16px',
                margin: 0,
                fontSize: 14,
              }}
            >
              <Fact
                label="Experience"
                value={`${selected.yearsExperience} ${
                  selected.yearsExperience === 1 ? 'year' : 'years'
                }`}
                numeric
              />
              <Fact label="Applied" value={formatDate(selected.createdAt)} numeric />
              {selected.decidedAt ? (
                <Fact label="Decided" value={formatDate(selected.decidedAt)} numeric />
              ) : null}
            </dl>

            <Field label="About them">
              {selected.bio || <Muted>Nothing written.</Muted>}
            </Field>

            <Field label="What they coach">
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

            <Field label="Certificates">
              {selected.certifications.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
                  {selected.certifications.map((c, i) => (
                    <li key={`${c.title}-${i}`}>
                      {c.title}
                      {c.issuer ? (
                        <span style={{ color: 'var(--gt-text-dim)' }}> · {c.issuer}</span>
                      ) : null}
                      {c.year ? (
                        <span className="gt-numeric" style={{ color: 'var(--gt-text-dim)' }}>
                          {' '}
                          ({c.year})
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted>None listed.</Muted>
              )}
            </Field>

            <Field label="Achievements">
              {selected.achievements.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
                  {selected.achievements.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : (
                <Muted>None listed.</Muted>
              )}
            </Field>

            {selected.reviewNote ? (
              <Field label="Reviewer note">{selected.reviewNote}</Field>
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
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--gt-text-faint)',
          fontFamily: 'var(--font-heading)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {children}
      </div>
    </div>
  );
}

/** One term/value pair in the applicant's fact list. */
function Fact({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ color: 'var(--gt-text-dim)', whiteSpace: 'nowrap' }}>{label}</dt>
      <dd
        className={numeric ? 'gt-numeric' : undefined}
        style={{ margin: 0, textAlign: 'right', color: 'var(--gt-text)' }}
      >
        {value}
      </dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 13, color: 'var(--gt-text-faint)' }}>{children}</span>
  );
}
