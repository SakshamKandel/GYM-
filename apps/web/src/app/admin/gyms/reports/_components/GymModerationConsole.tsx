'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, type Column, DataTable } from '@/components/console';
import type { GymReportRow, GymReviewRow } from './types';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

type Tab = 'reports' | 'reviews';

/**
 * Combined gym-listing moderation console (plan §5 WP-11 — "report +
 * review-moderation queue"). Two tabs sharing one page:
 *  - Reports: member-flagged wrong-info (open queue, oldest-first).
 *  - Reviews: genuine member reviews with a hide/show lever (Pack C).
 * Client-fetches both feeds on mount (no SSR data prop — this console is a
 * small ops queue, not a first-paint-critical page) and refetches after
 * every mutating action so state never drifts from the server.
 */
export function GymModerationConsole() {
  const [tab, setTab] = useState<Tab>('reports');
  const [reports, setReports] = useState<GymReportRow[] | null>(null);
  const [reviews, setReviews] = useState<GymReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    void (async () => {
      try {
        const [reportsRes, reviewsRes] = await Promise.all([
          fetch('/api/admin/gyms/reports', { credentials: 'include' }),
          fetch('/api/admin/gyms/reviews', { credentials: 'include' }),
        ]);
        if (!reportsRes.ok || !reviewsRes.ok) {
          setError('Could not load the moderation queue.');
          return;
        }
        const reportsData = (await reportsRes.json()) as { reports: GymReportRow[] };
        const reviewsData = (await reviewsRes.json()) as { reviews: GymReviewRow[] };
        setReports(reportsData.reports);
        setReviews(reviewsData.reviews);
        setError(null);
      } catch {
        setError('Network error loading the moderation queue.');
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
        setError("Couldn't update that report — try again.");
        return;
      }
      load();
    } catch {
      setError('Network error — try again.');
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
        setError("Couldn't update that review — try again.");
        return;
      }
      load();
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusyId(null);
    }
  }

  const openReportsCount = reports?.filter((r) => r.status === 'open').length ?? 0;
  const visibleReviewsCount = reviews?.filter((r) => r.status === 'visible').length ?? 0;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant={tab === 'reports' ? 'dark' : 'ghost'} size="sm" onClick={() => setTab('reports')}>
          Reports {openReportsCount > 0 ? `(${openReportsCount} open)` : ''}
        </Button>
        <Button variant={tab === 'reviews' ? 'dark' : 'ghost'} size="sm" onClick={() => setTab('reviews')}>
          Reviews ({visibleReviewsCount} visible)
        </Button>
      </div>

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
                      {DATE_FMT.format(new Date(r.createdAt))}
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
      ) : (
        <Card padded={false}>
          <CardHeader title="Member reviews" action={<span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>Hide abusive or fake reviews — hiding drops them from the public rating instantly</span>} />
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
                      {DATE_FMT.format(new Date(r.createdAt))}
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
      )}
    </div>
  );
}
