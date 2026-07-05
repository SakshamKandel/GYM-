import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STAFF_ROLES,
  STAFF_ROLE_RANK,
  assignableRolesFor,
  canManageRole,
  isStaffRole,
  outranks,
  type StaffRole,
} from './staffRoles.ts';

describe('STAFF_ROLE_RANK', () => {
  it('super_admin outranks main_admin outranks every sub-role', () => {
    assert.ok(STAFF_ROLE_RANK.super_admin > STAFF_ROLE_RANK.main_admin);
    for (const sub of [
      'member_admin',
      'nutrition_admin',
      'content_admin',
      'support_admin',
      'coach',
    ] as const) {
      assert.ok(STAFF_ROLE_RANK.main_admin > STAFF_ROLE_RANK[sub]);
    }
  });
  it('all sub-roles share the same lowest rank', () => {
    assert.equal(STAFF_ROLE_RANK.member_admin, STAFF_ROLE_RANK.coach);
    assert.equal(STAFF_ROLE_RANK.content_admin, STAFF_ROLE_RANK.support_admin);
    assert.equal(STAFF_ROLE_RANK.nutrition_admin, STAFF_ROLE_RANK.member_admin);
  });
  it('covers every role exactly once', () => {
    assert.equal(Object.keys(STAFF_ROLE_RANK).length, STAFF_ROLES.length);
  });
});

describe('isStaffRole', () => {
  it('accepts every known role including main_admin', () => {
    for (const role of STAFF_ROLES) assert.equal(isStaffRole(role), true);
  });
  it('rejects unknown strings and non-strings', () => {
    assert.equal(isStaffRole('root'), false);
    assert.equal(isStaffRole(''), false);
    assert.equal(isStaffRole(3), false);
    assert.equal(isStaffRole(null), false);
  });
});

describe('outranks', () => {
  it('is strict — equal rank never outranks', () => {
    assert.equal(outranks('main_admin', 'main_admin'), false);
    assert.equal(outranks('member_admin', 'coach'), false);
    assert.equal(outranks('super_admin', 'super_admin'), false);
  });
  it('higher rank outranks lower', () => {
    assert.equal(outranks('super_admin', 'main_admin'), true);
    assert.equal(outranks('main_admin', 'coach'), true);
  });
  it('lower rank never outranks higher', () => {
    assert.equal(outranks('main_admin', 'super_admin'), false);
    assert.equal(outranks('coach', 'main_admin'), false);
  });
});

describe('canManageRole', () => {
  it('super_admin manages everyone, including peers (all-powerful)', () => {
    for (const role of STAFF_ROLES) {
      assert.equal(canManageRole('super_admin', role), true);
    }
  });
  it('main_admin manages sub-roles only', () => {
    assert.equal(canManageRole('main_admin', 'member_admin'), true);
    assert.equal(canManageRole('main_admin', 'nutrition_admin'), true);
    assert.equal(canManageRole('main_admin', 'content_admin'), true);
    assert.equal(canManageRole('main_admin', 'support_admin'), true);
    assert.equal(canManageRole('main_admin', 'coach'), true);
  });
  it('main_admin can NEVER touch a peer or higher', () => {
    assert.equal(canManageRole('main_admin', 'main_admin'), false);
    assert.equal(canManageRole('main_admin', 'super_admin'), false);
  });
  it('sub-roles manage nobody', () => {
    for (const actor of [
      'member_admin',
      'nutrition_admin',
      'content_admin',
      'support_admin',
      'coach',
    ] as const) {
      for (const target of STAFF_ROLES) {
        assert.equal(canManageRole(actor, target), false);
      }
    }
  });
});

describe('unknown role strings (corrupt DB rows)', () => {
  // admins.role is a plain text column — a hand-written SQL insert can put
  // any string in it. These pin the safety properties: non-supers fail
  // closed against a role they can't rank, and a super_admin can still
  // manage (clean up) the corrupt row.
  const bogus = 'bogus_role' as StaffRole;
  it('non-super actors fail closed against unknown roles', () => {
    assert.equal(canManageRole('main_admin', bogus), false);
    assert.equal(outranks(bogus, 'coach'), false);
  });
  it('super_admin can still manage an unknown-role row', () => {
    assert.equal(canManageRole('super_admin', bogus), true);
  });
});

describe('assignableRolesFor', () => {
  it('super_admin may assign every role', () => {
    assert.deepEqual(assignableRolesFor('super_admin'), [...STAFF_ROLES]);
  });
  it('main_admin may assign only the sub-roles', () => {
    assert.deepEqual(assignableRolesFor('main_admin'), [
      'member_admin',
      'nutrition_admin',
      'content_admin',
      'support_admin',
      'coach',
    ]);
  });
  it('sub-roles may assign nothing', () => {
    assert.deepEqual(assignableRolesFor('coach'), []);
    assert.deepEqual(assignableRolesFor('support_admin'), []);
  });
});
