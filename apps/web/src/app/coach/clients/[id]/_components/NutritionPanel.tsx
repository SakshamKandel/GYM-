'use client';

import type {
  CoachClientMeal,
  CoachClientNutritionDay,
  CoachClientNutritionResponse,
} from '@gym/shared';
import { ChartCard, type ChartPoint } from '@/components/console';
import {
  fmtDate,
  fmtShortDay,
  PanelEmpty,
  PanelState,
  Stat,
  StatRow,
  usePanelData,
} from './panelKit';

/**
 * Client-detail → Food. Read-only view of what the client actually ate and
 * drank, straight from their own synced logs (GET .../nutrition, which bounds
 * the window and masks every food name server-side).
 *
 * Averages are taken over DAYS THE CLIENT LOGGED, never over the whole window —
 * dividing by 30 when someone logged 4 days would invent an adherence number
 * that reads like starvation. Days with nothing logged simply aren't in the
 * data, and the copy says so.
 */

const RANGE_DAYS = 30;
const CHART_DAYS = 14;
const RECENT_DAYS = 7;

const MEAL_LABELS: Record<CoachClientMeal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Whole number, thousands-separated — macros are never shown to the gram-tenth. */
function round(value: number): string {
  return Math.round(value).toLocaleString();
}

function targetHint(actual: number | null, target: number | null, unit: string): string | undefined {
  if (actual === null || target === null || target <= 0) return undefined;
  return `${Math.round((actual / target) * 100)}% of ${round(target)}${unit} goal`;
}

export function NutritionPanel({ userId }: { userId: string }) {
  const { data, error, loading } = usePanelData<CoachClientNutritionResponse>(
    `/api/coach/clients/${encodeURIComponent(userId)}/nutrition?days=${RANGE_DAYS}`,
  );
  if (!data) return <PanelState error={error} loading={loading} />;

  const foodDays = data.days.filter((d) => d.entries.length > 0);
  const waterDays = data.days.filter((d) => d.waterMl > 0);

  if (!data.synced || (foodDays.length === 0 && waterDays.length === 0)) {
    return (
      <PanelEmpty>
        Nothing logged in the last {RANGE_DAYS} days. Food and water show up here once your client
        logs them in the app.
      </PanelEmpty>
    );
  }

  const avgKcal = average(foodDays.map((d) => d.kcal));
  const avgProtein = average(foodDays.map((d) => d.protein));
  const avgCarbs = average(foodDays.map((d) => d.carbs));
  const avgFat = average(foodDays.map((d) => d.fat));
  const avgWater = average(waterDays.map((d) => d.waterMl));

  const chart: ChartPoint[] = foodDays.slice(-CHART_DAYS).map((d) => ({
    label: fmtShortDay(d.date),
    value: Math.round(d.kcal),
  }));

  const recent = [...data.days].reverse().slice(0, RECENT_DAYS);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatRow>
        <Stat
          label="Calories a day"
          value={avgKcal === null ? '—' : round(avgKcal)}
          hint={targetHint(avgKcal, data.targets?.kcal ?? null, '')}
        />
        <Stat
          label="Protein a day"
          value={avgProtein === null ? '—' : `${round(avgProtein)} g`}
          hint={targetHint(avgProtein, data.targets?.protein ?? null, 'g')}
        />
        <Stat label="Carbs a day" value={avgCarbs === null ? '—' : `${round(avgCarbs)} g`} />
        <Stat label="Fat a day" value={avgFat === null ? '—' : `${round(avgFat)} g`} />
        <Stat
          label="Water a day"
          value={avgWater === null ? '—' : `${(avgWater / 1000).toFixed(1)} L`}
          hint={targetHint(avgWater, data.targets?.waterMl ?? null, 'ml')}
        />
        <Stat
          label="Days logged"
          value={`${foodDays.length}`}
          hint={`of the last ${data.rangeDays} days`}
        />
      </StatRow>

      {chart.length > 1 ? (
        <ChartCard
          title="Calories by day"
          caption={`Days with food logged · last ${CHART_DAYS} of them`}
          data={chart}
          valueFormat={(v) => `${Math.round(v).toLocaleString()}`}
          height={220}
        />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recent.map((day) => (
          <DayCard key={day.date} day={day} />
        ))}
      </div>

      {data.days.length > RECENT_DAYS ? (
        <div style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          Showing the {RECENT_DAYS} most recent logged days.
        </div>
      ) : null}
    </div>
  );
}

function DayCard({ day }: { day: CoachClientNutritionDay }) {
  return (
    <div className="gt-card" style={{ padding: 14 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}
      >
        <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>
          {fmtDate(day.date)}
        </strong>
        <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
          {round(day.kcal)} kcal · P {round(day.protein)} · C {round(day.carbs)} · F{' '}
          {round(day.fat)}
          {day.waterMl > 0 ? ` · ${(day.waterMl / 1000).toFixed(1)} L water` : ''}
        </span>
      </div>
      {day.entries.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 6 }}>
          Water only, no food logged.
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {day.entries.map((entry) => (
            <div
              key={entry.id}
              className="gt-numeric"
              style={{ fontSize: 13, display: 'flex', gap: 8, color: 'var(--gt-text-dim)' }}
            >
              <span style={{ flex: 1, color: 'var(--gt-text)' }}>{entry.foodName}</span>
              <span>{MEAL_LABELS[entry.meal]}</span>
              <span>
                {Math.round(entry.grams)}g · {round(entry.kcal)} kcal
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
