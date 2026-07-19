import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS,
  cronDedupeKey,
  defaultNotificationPrefs,
  isEventPushEnabled,
  isWithinQuietHours,
  notificationCategory,
  notificationDelivery,
  type NotificationEvent,
} from './notifications.ts';

describe('event taxonomy', () => {
  it('every event maps to a known category', () => {
    for (const event of Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]) {
      assert.ok(
        NOTIFICATION_CATEGORIES.includes(notificationCategory(event)),
        `${event} → unknown category`,
      );
    }
  });
});

describe('preferences default all-on', () => {
  const prefs = defaultNotificationPrefs();
  it('missing prefs / missing category are enabled', () => {
    assert.equal(isEventPushEnabled(null, 'order_status'), true);
    assert.equal(isEventPushEnabled(prefs, 'order_status'), true);
  });
  it('an explicit false disables the whole category', () => {
    const off = { ...prefs, categories: { orders: { push: false } } };
    assert.equal(isEventPushEnabled(off, 'order_status'), false);
    assert.equal(isEventPushEnabled(off, 'payment_reviewed_member'), true); // other category
  });
});

describe('isWithinQuietHours', () => {
  it('same-day window is half-open [start, end)', () => {
    assert.equal(isWithinQuietHours(600, 660, 600), true); // 10:00 in [10:00,11:00)
    assert.equal(isWithinQuietHours(600, 660, 659), true);
    assert.equal(isWithinQuietHours(600, 660, 660), false); // end exclusive
    assert.equal(isWithinQuietHours(600, 660, 599), false);
  });
  it('window wrapping midnight (22:00 → 07:00)', () => {
    const start = 22 * 60;
    const end = 7 * 60;
    assert.equal(isWithinQuietHours(start, end, 23 * 60), true);
    assert.equal(isWithinQuietHours(start, end, 2 * 60), true);
    assert.equal(isWithinQuietHours(start, end, 12 * 60), false);
  });
  it('null endpoints or zero-length window = no quiet hours', () => {
    assert.equal(isWithinQuietHours(null, 600, 300), false);
    assert.equal(isWithinQuietHours(600, null, 300), false);
    assert.equal(isWithinQuietHours(600, 600, 600), false);
  });
});

describe('notificationDelivery', () => {
  const prefs = defaultNotificationPrefs();
  it('disabled category drops entirely (no inbox, no push)', () => {
    const off = { ...prefs, categories: { orders: { push: false } } };
    assert.deepEqual(notificationDelivery(off, 'order_status', 600), {
      writeInbox: false,
      sendPush: false,
    });
  });
  it('quiet hours writes inbox but suppresses push', () => {
    const quiet = { ...prefs, quietHoursStart: 22 * 60, quietHoursEnd: 7 * 60 };
    assert.deepEqual(notificationDelivery(quiet, 'order_status', 23 * 60), {
      writeInbox: true,
      sendPush: false,
    });
  });
  it('normal case delivers both', () => {
    assert.deepEqual(notificationDelivery(prefs, 'order_status', 12 * 60), {
      writeInbox: true,
      sendPush: true,
    });
  });
});

describe('cronDedupeKey', () => {
  it('formats event:accountId:scope', () => {
    assert.equal(
      cronDedupeKey('trial_expiry', 'acc_1', '2026-07-19'),
      'trial_expiry:acc_1:2026-07-19',
    );
  });
});
