'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, type Column, DataTable } from '@/components/console';
import { formatDateTime } from '@/lib/format';
import { QueueTabs } from '../../../_components/QueueTabs';
import { useUrlState } from '../../../_components/useUrlState';
import type { GymReportRow, GymReviewRow } from './types';

const TABS = ['reports', 'reviews', 'enquiries'] as const;
type Tab = (typeof TABS)[number];

type EnquiryStatus = 'open' | 'contacted' | 'closed';

/**
 * One membership / day-pass lead from GET /api/admin/gyms/enquiries. Declared
 * here rather than in ./types.ts because that file is owned elsewhere this
 * wave; it can move alongside the other row types later with no call-site
 * change.
 */
interface GymEnquiryRow {
  id: string;
  gymId: string;
  gymName: string;
  gymSlug: string;
  passId: string | null;
  passTitle: string | null;
  message: string;
  status: EnquiryStatus;
  createdAt: string;
  memberName: string;
  memberEmail: string;
}

/**
 * Combined gym-listing moderation console (plan §5 WP-11 — "report +
 * review-moderation queue"). Three tabs sharing one page:
 *  - Reports: member-flagged wrong-info (open queue, oldest-first).
 *  - Reviews: genuine member reviews with a hide/show lever (Pack C).
 *  - Enquiries: membership / day-pass leads someone has to actually answer —
 *    the member was told "the team will reach out", so this queue is the
 *    promise. Open leads carry a contact email; the row is the record.
 * Client-fetches all three feeds on mount (no SSR data prop — this console is
 * a small ops queue, not a first-paint-critical page) and refetches after
 * every mutating action so state never drifts from the server.
 */
export function GymModerationConsole() {
  // In the URL, so returning from a gym listing lands on the queue that sent
  // you there.
  const [tab, setTab] = useUrlState<Tab>('tab', 'reports', TABS);
  const [reports, setReports] = useState<GymReportRow[] | null>(null);
  const [reviews, setReviews] = useState<GymReviewRow[] | null>(null);
  const [enquiries, setEnquiries] = useState<GymEnquiryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    void (async () => {
      try {
        const [reportsRes, reviewsRes, enquiriesRes] = await Promise.all([
          fetch('/api/admin/gyms/reports', { credentials: 'include' }),
          fetch('/api/admin/gyms/reviews', { credentials: 'include' }),
          fetch('/api/admin/gyms/enquiries', { credentials: 'include' }),
        ]);
        if (!reportsRes.ok || !reviewsRes.ok || !enquiriesRes.ok) {
          setError('Could not load the moderation queue.');
          return;
        }
        const reportsData = (await reportsRes.json()) as { reports: GymReportRow[] };
        const reviewsData = (await reviewsRes.json()) as { reviews: GymReviewRow[] };
        const enquiriesData = (await enquiriesRes.json()) as { enquiries: GymEnquiryRow[] };
        setReports(reportsData.reports);
        setReviews(reviewsData.reviews);
        setEnquiries(enquiriesData.enquiries);
        setError(null);
      } catch {
        setError('Could not load what is waiting on you. Try again.');
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decideReport(id: string, status: 'resolved' | 'dismissed') {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/gyms/reports/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError("Couldn't update that report. Try again.");
        return;
      }
      load();
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function moderateReview(id: string, status: 'visible' | 'hidden') {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/gyms/reviews/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError("Couldn't update that review. Try again.");
        return;
      }
      load();
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function setEnquiryStatus(id: string, status: EnquiryStatus) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/gyms/enquiries/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError("Couldn't update that enquiry. Try again.");
        return;
      }
      load();
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  const openReportsCount = reports?.filter((r) => r.status === 'open').length ?? 0;
  const visibleReviewsCount = reviews?.filter((r) => r.status === 'visible').length ?? 0;
  const openEnquiriesCount = enquiries?.filter((e) => e.status === 'open').length ?? 0;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Three buttons that changed variant when chosen read as three separate
          actions, not one control with one answer. Same segmented control the
          rest of the console uses, and the count is what an operator is
          actually picking between. */}
      <QueueTabs
        label="Which gym queue to work"
        tabs={[
          { key: 'reports', label: 'Reports', count: openReportsCount },
          { key: 'reviews', label: 'Reviews', count: visibleReviewsCount },
          { key: 'enquiries', label: 'Enquiries', count: openEnquiriesCount },
        ]}
        value={tab}
        onChange={setTab}
      />

      {error ? <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div> : null}

      {tab === 'reports' ? (
        <Card padded={false}>
          <CardHeader title="Listing-correction reports" />
          <DataTable
            columns={
              [
                {
                  key: 'gym',
                  header: 'Gym',
                  render: (r) => <span style={{ fontSize: 13 }}>{r.gymName}</span>,
                },
                {
                  key: 'field',
                  header: 'Field',
                  width: 100,
                  render: (r) => <Badge tone="info">{r.field}</Badge>,
                },
                {
                  key: 'note',
                  header: 'Note',
                  render: (r) => (
                    <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{r.note || '—'}</span>
                  ),
                },
                {
                  key: 'reporter',
                  header: 'Reported by',
                  render: (r) => <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.reporterEmail}</span>,
                },
                {
                  key: 'when',
                  header: 'When',
                  width: 150,
                  render: (r) => (
                    <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      {formatDateTime(r.createdAt)}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  width: 100,
                  render: (r) => (
                    <Badge tone={r.status === 'open' ? 'warning' : r.status === 'resolved' ? 'positive' : 'neutral'}>
                      {r.status}
                    </Badge>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  width: 190,
                  render: (r) =>
                    r.status === 'open' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === r.id}
                          onClick={() => void decideReport(r.id, 'resolved')}
                        >
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => void decideReport(r.id, 'dismissed')}
                        >
                          Dismiss
                        </Button>
                      </div>
                    ) : null,
                },
              ] satisfies Column<GymReportRow>[]
            }
            rows={reports ?? []}
            rowKey={(r) => r.id}
            empty={reports === null ? 'Loading…' : 'No reports yet.'}
          />
        </Card>
      ) : tab === 'reviews' ? (
        <Card padded={false}>
          <CardHeader title="Member reviews" action={<span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Hide abusive or fake reviews. Hiding drops them from the public rating instantly</span>} />
          <DataTable
            columns={
              [
                {
                  key: 'gym',
                  header: 'Gym',
                  render: (r) => <span style={{ fontSize: 13 }}>{r.gymName}</span>,
                },
                {
                  key: 'stars',
                  header: 'Stars',
                  width: 70,
                  align: 'right',
                  render: (r) => r.stars,
                },
                {
                  key: 'note',
                  header: 'Review',
                  render: (r) => (
                    <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{r.note || '—'}</span>
                  ),
                },
                {
                  key: 'author',
                  header: 'Author',
                  render: (r) => <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.authorEmail}</span>,
                },
                {
                  key: 'when',
                  header: 'When',
                  width: 150,
                  render: (r) => (
                    <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      {formatDateTime(r.createdAt)}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  width: 90,
                  render: (r) => <Badge tone={r.status === 'visible' ? 'positive' : 'critical'}>{r.status}</Badge>,
                },
                {
                  key: 'actions',
                  header: '',
                  width: 100,
                  render: (r) => (
                    <Button
                      size="sm"
                      variant={r.status === 'visible' ? 'danger' : 'ghost'}
                      disabled={busyId === r.id}
                      onClick={() => void moderateReview(r.id, r.status === 'visible' ? 'hidden' : 'visible')}
                    >
                      {r.status === 'visible' ? 'Hide' : 'Show'}
                    </Button>
                  ),
                },
              ] satisfies Column<GymReviewRow>[]
            }
            rows={reviews ?? []}
            rowKey={(r) => r.id}
            empty={reviews === null ? 'Loading…' : 'No reviews yet.'}
          />
        </Card>
      ) : (
        <Card padded={false}>
          <CardHeader
            title="Membership enquiries"
            action={
              <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                Each member here was told the team would reach out. Mark contacted once you have
              </span>
            }
          />
          <DataTable
            columns={
              [
                {
                  key: 'gym',
                  header: 'Gym',
                  render: (e) => <span style={{ fontSize: 13 }}>{e.gymName}</span>,
                },
                {
                  key: 'pass',
                  header: 'Interest',
                  width: 130,
                  render: (e) =>
                    e.passTitle ? (
                      <Badge tone="info">{e.passTitle}</Badge>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Membership</span>
                    ),
                },
                {
                  key: 'message',
                  header: 'Message',
                  render: (e) => (
                    <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>{e.message || '—'}</span>
                  ),
                },
                {
                  key: 'member',
                  header: 'Member',
                  render: (e) => (
                    <div style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: 13 }}>{e.memberName || 'Member'}</span>
                      <a
                        href={`mailto:${e.memberEmail}`}
                        style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}
                      >
                        {e.memberEmail}
                      </a>
                    </div>
                  ),
                },
                {
                  key: 'when',
                  header: 'When',
                  width: 150,
                  render: (e) => (
                    <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
                      {formatDateTime(e.createdAt)}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  width: 110,
                  render: (e) => (
                    <Badge
                      tone={e.status === 'open' ? 'warning' : e.status === 'contacted' ? 'info' : 'positive'}
                    >
                      {e.status}
                    </Badge>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  width: 210,
                  render: (e) => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      {e.status === 'open' ? (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === e.id}
                          onClick={() => void setEnquiryStatus(e.id, 'contacted')}
                        >
                          Mark contacted
                        </Button>
                      ) : null}
                      {e.status === 'closed' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === e.id}
                          onClick={() => void setEnquiryStatus(e.id, 'open')}
                        >
                          Reopen
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === e.id}
                          onClick={() => void setEnquiryStatus(e.id, 'closed')}
                        >
                          Close
                        </Button>
                      )}
                    </div>
                  ),
                },
              ] satisfies Column<GymEnquiryRow>[]
            }
            rows={enquiries ?? []}
            rowKey={(e) => e.id}
            empty={enquiries === null ? 'Loading…' : 'No enquiries yet.'}
          />
        </Card>
      )}
    </div>
  );
}
