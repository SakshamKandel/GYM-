import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { smoothWeights, trendSummary } from './trend.ts';

describe('smoothWeights', () => {
  it('first point equals the raw weight', () => {
    const out = smoothWeights([{ date: '2026-07-01', kg: 80 }]);
    assert.equal(out[0]!.trendKg, 80);
  });
  it('damps single-day spikes (scale noise)', () => {
    const out = smoothWeights([
      { date: '2026-07-01', kg: 80 },
      { date: '2026-07-02', kg: 83 }, // +3kg overnight is water, not fat
    ]);
    assert.ok(out[1]!.trendKg < 81.1);
    assert.ok(out[1]!.trendKg > 80);
  });
  it('sorts unordered input by date', () => {
    const out = smoothWeights([
      { date: '2026-07-03', kg: 81 },
      { date: '2026-07-01', kg: 80 },
    ]);
    assert.equal(out[0]!.date, '2026-07-01');
  });
  it('converges toward a stable weight', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      kg: 75,
    }));
    const out = smoothWeights([{ date: '2026-05-01', kg: 80 }, ...entries]);
    assert.ok(Math.abs(out[out.length - 1]!.trendKg - 75) < 0.1);
  });
});

describe('trendSummary', () => {
  it('flat when nothing changes', () => {
    const points = smoothWeights(
      Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-0${i + 1}`, kg: 80 })),
    );
    assert.equal(trendSummary(points).direction, 'flat');
  });
  it('down direction with a weekly rate for steady loss', () => {
    const points = smoothWeights(
      Array.from({ length: 21 }, (_, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, '0')}`,
        kg: 85 - i * 0.1, // ~0.7 kg/week
      })),
    );
    const s = trendSummary(points, 7);
    assert.equal(s.direction, 'down');
    assert.ok(s.ratePerWeekKg < -0.3 && s.ratePerWeekKg > -1.2);
  });
  it('handles fewer than two points', () => {
    assert.equal(trendSummary([]).direction, 'flat');
  });
});
