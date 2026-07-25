import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COACH_SPECIALTIES, containsPii, isCoachSpecialty, maskPii, PII_MASK } from './mentorship.ts';

/** Asserts the body came back byte-for-byte unchanged. */
function untouched(body: string): void {
  assert.equal(maskPii(body), body, `expected to pass through: ${body}`);
}

/** Asserts something was hidden, without pinning the exact span. */
function hidden(body: string): void {
  assert.ok(maskPii(body).includes(PII_MASK), `expected a mask in: ${body}`);
  assert.equal(containsPii(body), true, `expected containsPii true for: ${body}`);
}

describe('maskPii — contact details', () => {
  it('masks email addresses', () => {
    assert.equal(maskPii('write me at greece.m+vip@gmail.com ok'), `write me at ${PII_MASK} ok`);
  });

  it('masks international phone numbers with separators', () => {
    assert.equal(maskPii('call +977 98-4123-4567 tonight'), `call ${PII_MASK} tonight`);
    assert.equal(maskPii('my number is 9841234567'), `my number is ${PII_MASK}`);
    assert.equal(maskPii('(415) 555-2671'), PII_MASK);
    assert.equal(maskPii('reach me: 984-123-4567'), `reach me: ${PII_MASK}`);
  });

  it('masks social handles', () => {
    assert.equal(maskPii('dm me @greece_lifts on insta'), `dm me ${PII_MASK} on insta`);
  });

  it('is idempotent', () => {
    const once = maskPii('email me a@b.co or 98412345678');
    assert.equal(maskPii(once), once);
    const twice = maskPii('name at gmail dot com, or wa.me/9779841234567');
    assert.equal(maskPii(twice), twice);
  });

  it('containsPii flags only real hits', () => {
    assert.equal(containsPii('mail me x@y.dev'), true);
    assert.equal(containsPii('squat 100kg for 5'), false);
  });
});

describe('maskPii — evasions', () => {
  it('handles digits spelled out in full', () => {
    assert.equal(maskPii('nine eight four two'), PII_MASK);
    assert.equal(maskPii('nine-eight-four'), PII_MASK);
    hidden('nine eight four one two three four five six seven');
  });

  it('handles digits half spelled out, half typed', () => {
    assert.equal(maskPii('ring me on 98 four two now'), `ring me on ${PII_MASK} now`);
  });

  it('handles digits spaced out one at a time', () => {
    assert.equal(maskPii('my cell 9 8 4 1 2 3 4 5 6 7 call me'), `my cell ${PII_MASK} call me`);
  });

  it('handles obfuscated email addresses', () => {
    assert.equal(maskPii('name at gmail dot com'), PII_MASK);
    assert.equal(maskPii('name(at)gmail(dot)com'), PII_MASK);
    assert.equal(maskPii('name [at] gmail [dot] com'), PII_MASK);
  });

  it('handles platform links that carry no @ at all', () => {
    assert.equal(maskPii('wa.me/9779841234567'), PII_MASK);
    assert.equal(maskPii('t.me/greecelifts'), PII_MASK);
    assert.equal(maskPii('m.me/greece'), PII_MASK);
    assert.equal(maskPii('ig.me/greece'), PII_MASK);
    assert.equal(maskPii('signal.me/#p/+9779841234567'), PII_MASK);
    assert.equal(maskPii('discord.gg/abc123'), PII_MASK);
    assert.equal(maskPii('linktr.ee/greece'), PII_MASK);
    assert.equal(maskPii('instagram.com/greece_lifts'), PII_MASK);
    assert.equal(maskPii('https://wa.me/message/ABC'), PII_MASK);
    hidden('hit me on telegram');
    hidden('add me on snapchat');
    hidden('find me on facebook');
  });

  it('handles handles at any position, not only after a space', () => {
    hidden('here:@greece_lifts');
    hidden('dm (@greece_lifts) please');
    hidden('sub me @gr.lifts.np now');
  });

  it('handles look-alike letters standing in for digits', () => {
    assert.equal(maskPii('number: 98O41234567'), `number: ${PII_MASK}`);
    assert.equal(maskPii('number: 984l234567'), `number: ${PII_MASK}`);
  });

  it('handles non-ASCII digits and zero-width padding', () => {
    // A full-width four inside the number, and zero-width spaces wedged between
    // digits. Written as escapes so no editor can quietly eat them.
    const fullWidth = 'reach me at 98\uFF141234567';
    assert.equal(maskPii(fullWidth), `reach me at ${PII_MASK}`);
    const padded = 'my cell is 98\u200B41\u200B234567 ok';
    assert.equal(maskPii(padded), `my cell is ${PII_MASK} ok`);
  });
});

describe('maskPii — leaves training talk alone', () => {
  it('leaves gym numbers alone', () => {
    untouched('Did 5x5 at 102.5kg, RPE 8. 2300 kcal, 180g protein. Rest 90s.');
    untouched('3x8 at 82.5');
    untouched('squat 100kg for 5');
  });

  it('leaves a warm-up ladder alone', () => {
    untouched('warm up 40 50 60 70 80 90 100 then work sets');
    untouched('Deload week: 40 45 50 55 60 for 3s, then reset.');
    untouched('Warm up: bar x10, 60x5, 80x3, 100x1, then work at 110.');
  });

  it('leaves rep schemes and set logs alone', () => {
    untouched('Reps last week: 8 8 7 6');
    untouched('Hit 10 10 10 8 8 on the leg press');
    untouched('Set 1: 100 x 5. Set 2: 105 x 5. Set 3: 110 x 3.');
    untouched('Week 1: 3x5 @ 60kg. Week 2: 3x5 @ 62.5kg. Week 3: 3x5 @ 65kg.');
  });

  it('leaves years, dates and prices alone', () => {
    untouched('Since 2019 I squat 3x a week, best set 140x5 in 2024.');
    untouched('Session on 2026-07-25 at 6pm');
    untouched('Renewed on 12-06-2026, next due 12-12-2026');
    untouched('Order #4821 arrives 25/07/2026');
    untouched('Plan is Rs 2,500 per month, or 12,500 for six months');
    untouched('That set cost me 1299.00 in plates');
    untouched('Payment of 3,500 cleared on 2026-07-14. Next due 2026-08-14.');
  });

  it('leaves a single spoken number next to a typed one alone', () => {
    untouched('did 100 five times');
    untouched('squat 140 three times today');
    untouched('three sets of eight');
    untouched('8 to 12 reps, rest 90 sec');
    untouched('one two');
  });

  it('leaves ordinary coaching sentences alone', () => {
    untouched('Take a look at the plan I attached.');
    untouched('Meet me at the gym at 6');
    untouched('Macros for the next block: 2600 kcal, 190 P, 300 C, 75 F.');
    untouched('Progress: 84.2, 83.8, 83.5, 83.1 kg over four weeks');
    untouched('Zone 2 cardio 30 min, HR 130 to 140');
  });
});

describe('specialties', () => {
  it('catalog is non-empty and guard accepts members', () => {
    assert.ok(COACH_SPECIALTIES.length >= 10);
    assert.equal(isCoachSpecialty('hypertrophy'), true);
    assert.equal(isCoachSpecialty('astrology'), false);
  });
});
