import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bmr, computeTargets, kcalFromMacros, scalePer100, tdee } from './macros.ts';

describe('macro math', () => {
  it('kcalFromMacros uses 4/4/9', () => {
    assert.equal(kcalFromMacros(100, 100, 50), 100 * 4 + 100 * 4 + 50 * 9);
  });
  it('scalePer100 scales linearly', () => {
    assert.equal(scalePer100(20, 150), 30);
    assert.equal(scalePer100(42, 100), 42);
    assert.equal(scalePer100(42, 0), 0);
  });
});

describe('bmr / tdee', () => {
  it('matches Mifflin-St Jeor for a known case', () => {
    // 80kg, 180cm, 30y male: 10*80 + 6.25*180 - 5*30 + 5 = 1780
    assert.equal(bmr('male', 80, 180, 30), 1780);
    assert.equal(bmr('female', 80, 180, 30), 1614);
  });
  it('tdee applies the activity multiplier', () => {
    assert.equal(tdee(1780, 'sedentary'), 2136);
  });
});

describe('computeTargets', () => {
  const base = {
    sex: 'male' as const,
    kg: 80,
    heightCm: 180,
    ageYears: 30,
    activity: 'moderate' as const,
  };
  it('fat loss sits in a deficit with high protein', () => {
    const t = computeTargets({ ...base, goal: 'fat_loss' });
    const maintenance = tdee(bmr('male', 80, 180, 30), 'moderate');
    assert.ok(t.kcal < maintenance);
    assert.equal(t.protein, Math.round(80 * 2.2));
  });
  it('muscle sits in a surplus', () => {
    const t = computeTargets({ ...base, goal: 'muscle' });
    const maintenance = tdee(bmr('male', 80, 180, 30), 'moderate');
    assert.ok(t.kcal > maintenance);
  });
  it('macros roughly add back up to the kcal target', () => {
    const t = computeTargets({ ...base, goal: 'strength' });
    const fromMacros = kcalFromMacros(t.protein, t.carbs, t.fat);
    assert.ok(Math.abs(fromMacros - t.kcal) < 40);
  });
  it('carbs never go negative', () => {
    const t = computeTargets({
      sex: 'female',
      kg: 45,
      heightCm: 150,
      ageYears: 70,
      activity: 'sedentary',
      goal: 'fat_loss',
    });
    assert.ok(t.carbs >= 0);
  });
});
