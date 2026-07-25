'use client';

import type { CoachClientBodyResponse, CoachClientMeasurement } from '@gym/shared';
import { DataTable, type Column } from '@/components/console';
import {
  fmtDate,
  PanelEmpty,
  PanelState,
  Sparkline,
  Stat,
  StatRow,
  usePanelData,
} from './panelKit';

/**
 * Client-detail → Body. Read-only view of the client's own scale history and
 * tape measurements (GET .../body). Distinct from the Weight tab, which shows
 * the weekly check-in weight the coach has already reviewed; this is the
 * day-to-day series the client records in the app.
 *
 * The headline number is the SMOOTHED trend, not the last reading — a single
 * high-salt morning is not a coaching signal, and showing the raw scale value
 * as the headline invites a coach to act on noise.
 */

const RANGE_DAYS = 90;

const MEASUREMENT_COLUMNS: Column<CoachClientMeasurement>[] = [
  { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
  { key: 'waist', header: 'Waist', align: 'right', render: (r) => cm(r.waistCm) },
  { key: 'chest', header: 'Chest', align: 'right', render: (r) => cm(r.chestCm) },
  { key: 'arm', header: 'Arm', align: 'right', render: (r) => cm(r.armCm) },
  { key: 'hip', header: 'Hip', align: 'right', render: (r) => cm(r.hipCm) },
  { key: 'thigh', header: 'Thigh', align: 'right', render: (r) => cm(r.thighCm) },
];

function cm(value: number | null): string {
  return value === null ? '—' : `${value} cm`;
}

export function BodyPanel({ userId }: { userId: string }) {
  const { data, error, loading } = usePanelData<CoachClientBodyResponse>(
    `/api/coach/clients/${encodeURIComponent(userId)}/body?days=${RANGE_DAYS}`,
  );
  if (!data) return <PanelState error={error} loading={loading} />;

  if (!data.synced || (data.points.length === 0 && data.measurements.length === 0)) {
    return (
      <PanelEmpty>
        Nothing logged in the last {RANGE_DAYS} days. Weigh-ins and measurements show up here once
        your client records them in the app.
      </PanelEmpty>
    );
  }

  const latest = data.points.length > 0 ? data.points[data.points.length - 1] : null;
  const first = data.points.length > 0 ? data.points[0] : null;
  const windowChange =
    latest && first ? Math.round((latest.trendKg - first.trendKg) * 10) / 10 : null;
  const arrow =
    data.summary.direction === 'up' ? '▲' : data.summary.direction === 'down' ? '▼' : '→';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatRow>
        <Stat
          label="Trend weight"
          value={latest ? `${latest.trendKg} kg` : '—'}
          hint={latest ? `last weigh-in ${fmtDate(latest.date)}` : undefined}
        />
        <Stat label="Last reading" value={latest ? `${latest.kg} kg` : '—'} />
        <Stat
          label="7-day change"
          value={`${arrow} ${Math.abs(data.summary.deltaKg)} kg`}
          hint={`${data.summary.ratePerWeekKg} kg a week`}
        />
        <Stat
          label="Since start of range"
          value={windowChange === null ? '—' : `${windowChange > 0 ? '+' : ''}${windowChange} kg`}
          hint={first ? `from ${fmtDate(first.date)}` : undefined}
        />
        <Stat label="Weigh-ins" value={String(data.points.length)} hint={`last ${data.rangeDays} days`} />
      </StatRow>

      {data.points.length > 1 ? (
        <div className="gt-card" style={{ padding: 14 }}>
          <Sparkline points={data.points} />
          <div style={{ fontSize: 12, color: 'var(--gt-text-dim)', marginTop: 4 }}>
            Smoothed trend across {data.points.length} weigh-ins. Day-to-day scale swings are
            averaged out.
          </div>
        </div>
      ) : null}

      <div>
        <div
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 15,
            margin: '4px 0 8px',
          }}
        >
          Measurements
        </div>
        <DataTable
          columns={MEASUREMENT_COLUMNS}
          rows={data.measurements}
          rowKey={(row) => row.id}
          empty="No measurements recorded in this range."
        />
      </div>
    </div>
  );
}
