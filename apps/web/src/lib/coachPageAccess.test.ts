import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@gym/shared';
import { canAccessCoachPage, isCoachConsoleRole } from './coachPageAccess.ts';

describe('coach server-page authorization', () => {
  it('accepts only coach-console roles', () => {
    assert.equal(isCoachConsoleRole('coach'), true);
    assert.equal(isCoachConsoleRole('super_admin'), true);
    assert.equal(isCoachConsoleRole('main_admin'), true);
    assert.equal(isCoachConsoleRole('member_admin'), false);
    assert.equal(isCoachConsoleRole('partner'), false);
  });

  it('honours a per-account deny before a protected page can load', () => {
    // This is the post-merge shape returned by effectivePermissionSet after an
    // explicit DENY strips coach.user.read from the coach role preset.
    const permissions = new Set<Permission>([
      'coach.message.user',
      'content.video.own',
      'coach.wallet.read',
    ]);

    assert.equal(canAccessCoachPage('coach', permissions, 'coach.user.read'), false);
    assert.equal(canAccessCoachPage('coach', permissions, 'coach.wallet.read'), true);
  });

  it('honours an extra allow but never turns a non-coach role into a coach', () => {
    const permissions = new Set<Permission>(['coach.user.read']);

    assert.equal(canAccessCoachPage('coach', permissions, 'coach.user.read'), true);
    assert.equal(canAccessCoachPage('support_admin', permissions, 'coach.user.read'), false);
  });

  it('supports OR-gated pages and keeps top-admin permissions unstrippable', () => {
    const ownVideo = new Set<Permission>(['content.video.own']);
    assert.equal(
      canAccessCoachPage('coach', ownVideo, ['content.manage', 'content.video.own']),
      true,
    );
    assert.equal(canAccessCoachPage('coach', ownVideo, 'coach.user.read'), false);

    const empty = new Set<Permission>();
    assert.equal(canAccessCoachPage('super_admin', empty, 'coach.user.read'), true);
    assert.equal(canAccessCoachPage('main_admin', empty, 'coach.wallet.read'), true);
  });
});
