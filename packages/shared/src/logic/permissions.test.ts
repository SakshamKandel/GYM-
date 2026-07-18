import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAFF_ROLES, type StaffRole } from './staffRoles.ts';
import {
  ADMIN_CONSOLE_ROLES,
  ALL_PERMISSIONS,
  COACH_CONSOLE_ROLES,
  GRANTABLE_ROLES,
  ROLE_PRESETS,
  hasPermission,
  isPermission,
  permissionsForRole,
  effectivePermissionsForRole,
  type Permission,
} from './permissions.ts';

describe('effectivePermissionsForRole', () => {
  it('applies both grants and explicit denials', () => {
    const overrides = new Map<Permission, boolean>([
      ['members.read', false],
      ['audit.read', true],
    ]);
    const effective = effectivePermissionsForRole('member_admin', overrides);
    assert.equal(effective.includes('members.read'), false);
    assert.equal(effective.includes('audit.read'), true);
  });

  it('never strips the super-admin safety floor', () => {
    const effective = effectivePermissionsForRole(
      'super_admin',
      new Map<Permission, boolean>([['roles.grant', false]]),
    );
    assert.equal(effective.includes('roles.grant'), true);
    assert.equal(effective.length, ALL_PERMISSIONS.length);
  });

  it('allows an intentionally empty effective set', () => {
    const denied = new Map<Permission, boolean>(
      ROLE_PRESETS.coach.map((permission) => [permission, false]),
    );
    assert.deepEqual(effectivePermissionsForRole('coach', denied), []);
  });
});

describe('ALL_PERMISSIONS key strings (snapshot — a rename must break this)', () => {
  it('is the exact frozen set of keys routes match on', () => {
    // Renaming/removing a key without updating the ~35 guard call sites is a
    // silent authz regression. This snapshot forces the rename to be deliberate.
    assert.deepEqual(
      [...ALL_PERMISSIONS],
      [
        'members.read',
        'members.suspend',
        'coach.assign',
        'subscription.override',
        'audit.read',
        'roles.grant',
        'support.thread.read',
        'support.thread.reply',
        'coach.application.review',
        'payments.review',
        'promo.manage',
        'pricing.manage',
        'wallet.manage',
        'content.manage',
        'content.video.own',
        'coach.message.user',
        'coach.user.read',
        'coach.wallet.read',
        'client.tier_grant',
        'broadcast.send',
        'members.manage_credentials',
        'payouts.review',
        'analytics.read',
        'permissions.override',
        'moderation.manage',
        'catalog.manage',
        'gamification.manage',
        'meals.own',
        'orders.fulfill',
        'partners.manage',
        'orders.review',
        'gyms.manage',
      ],
    );
  });
  it('retired key content.video.publish is gone', () => {
    assert.equal((ALL_PERMISSIONS as readonly string[]).includes('content.video.publish'), false);
  });
  it('has no duplicate keys', () => {
    assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
  });
});

describe('isPermission', () => {
  it('accepts every known key', () => {
    for (const perm of ALL_PERMISSIONS) assert.equal(isPermission(perm), true);
  });
  it('rejects unknown strings and the retired key', () => {
    assert.equal(isPermission('content.video.publish'), false);
    assert.equal(isPermission('root'), false);
    assert.equal(isPermission(''), false);
    assert.equal(isPermission(null), false);
    assert.equal(isPermission(3), false);
  });
});

describe('hasPermission — bypass roles', () => {
  it('super_admin and main_admin hold EVERY permission', () => {
    for (const perm of ALL_PERMISSIONS) {
      assert.equal(hasPermission('super_admin', perm), true);
      assert.equal(hasPermission('main_admin', perm), true);
    }
  });
});

describe('hasPermission — fail closed by default', () => {
  it('an unknown/corrupt role holds no permission', () => {
    const bogus = 'bogus_role' as StaffRole;
    for (const perm of ALL_PERMISSIONS) {
      assert.equal(hasPermission(bogus, perm), false);
    }
  });
  it('a real sub-role is denied a permission not in its preset', () => {
    assert.equal(hasPermission('support_admin', 'roles.grant'), false);
    assert.equal(hasPermission('content_admin', 'members.read'), false);
    assert.equal(hasPermission('member_admin', 'audit.read'), false);
  });
});

describe('hasPermission — coach exclusions (fixes critical A1 + major A2)', () => {
  it('coach can NEVER grant a client a tier', () => {
    assert.equal(hasPermission('coach', 'client.tier_grant'), false);
  });
  it('coach can NEVER manage content org-wide', () => {
    assert.equal(hasPermission('coach', 'content.manage'), false);
  });
  it('coach CAN do its self-scoped work', () => {
    assert.equal(hasPermission('coach', 'coach.message.user'), true);
    assert.equal(hasPermission('coach', 'coach.user.read'), true);
    assert.equal(hasPermission('coach', 'content.video.own'), true);
    assert.equal(hasPermission('coach', 'coach.wallet.read'), true);
  });
});

describe('client.tier_grant is in NO preset (only reachable via bypass)', () => {
  it('no non-bypass role carries it', () => {
    for (const role of STAFF_ROLES) {
      if (role === 'super_admin' || role === 'main_admin') continue;
      assert.equal(
        (ROLE_PRESETS[role] as readonly Permission[]).includes('client.tier_grant'),
        false,
      );
    }
  });
});

describe('nutrition_admin is deprecated (empty preset)', () => {
  it('holds zero permissions', () => {
    assert.deepEqual(ROLE_PRESETS.nutrition_admin, []);
    for (const perm of ALL_PERMISSIONS) {
      assert.equal(hasPermission('nutrition_admin', perm), false);
    }
  });
});

describe('member_admin preset', () => {
  it('owns member ops + its two review queues, nothing more', () => {
    assert.deepEqual([...ROLE_PRESETS.member_admin], [
      'members.read',
      'members.suspend',
      'coach.assign',
      'subscription.override',
      'coach.application.review',
      'payments.review',
    ]);
  });
});

describe('content_admin preset (P1/P2 — gains catalog + moderation)', () => {
  it('holds content.manage + catalog.manage + moderation.manage, nothing more', () => {
    assert.deepEqual([...ROLE_PRESETS.content_admin], [
      'content.manage',
      'catalog.manage',
      'moderation.manage',
    ]);
  });
  it('does NOT hold the super/main-only P1/P2 keys', () => {
    assert.equal(hasPermission('content_admin', 'members.manage_credentials'), false);
    assert.equal(hasPermission('content_admin', 'payouts.review'), false);
    assert.equal(hasPermission('content_admin', 'analytics.read'), false);
    assert.equal(hasPermission('content_admin', 'permissions.override'), false);
    assert.equal(hasPermission('content_admin', 'gamification.manage'), false);
  });
});

describe('P1/P2 super/main-only keys sit in NO sub-role preset', () => {
  const superMainOnly: Permission[] = [
    'members.manage_credentials',
    'payouts.review',
    'analytics.read',
    'permissions.override',
    'gamification.manage',
  ];
  it('only the bypass roles hold them', () => {
    for (const perm of superMainOnly) {
      for (const role of STAFF_ROLES) {
        const expected = role === 'super_admin' || role === 'main_admin';
        assert.equal(hasPermission(role, perm), expected, `${role} / ${perm}`);
      }
    }
  });
});

describe('catalog.manage + moderation.manage live ONLY on content_admin (+ bypass)', () => {
  it('no other sub-role carries them', () => {
    for (const perm of ['catalog.manage', 'moderation.manage'] as const) {
      for (const role of STAFF_ROLES) {
        if (role === 'super_admin' || role === 'main_admin' || role === 'content_admin') continue;
        assert.equal(hasPermission(role, perm), false, `${role} / ${perm}`);
      }
    }
  });
});

describe('support_admin preset is unchanged by the P1/P2 wave', () => {
  it('still exactly its three keys', () => {
    assert.deepEqual([...ROLE_PRESETS.support_admin], [
      'members.read',
      'support.thread.read',
      'support.thread.reply',
    ]);
  });
});

describe('permissionsForRole', () => {
  it('bypass roles return the full key list (fresh copy)', () => {
    assert.deepEqual(permissionsForRole('super_admin'), [...ALL_PERMISSIONS]);
    assert.deepEqual(permissionsForRole('main_admin'), [...ALL_PERMISSIONS]);
    // mutating the result must not corrupt the source
    const p = permissionsForRole('super_admin');
    p.pop();
    assert.equal(permissionsForRole('super_admin').length, ALL_PERMISSIONS.length);
  });
  it('a sub-role returns exactly its preset', () => {
    assert.deepEqual(permissionsForRole('content_admin'), [
      'content.manage',
      'catalog.manage',
      'moderation.manage',
    ]);
    assert.deepEqual(permissionsForRole('nutrition_admin'), []);
  });
  it('every listed permission is a real key', () => {
    for (const role of STAFF_ROLES) {
      for (const perm of permissionsForRole(role)) {
        assert.equal(isPermission(perm), true);
      }
    }
  });
});

describe('ROLE_PRESETS covers every role exactly once', () => {
  it('has an entry for each StaffRole', () => {
    assert.equal(Object.keys(ROLE_PRESETS).length, STAFF_ROLES.length);
    for (const role of STAFF_ROLES) {
      assert.ok(Array.isArray(ROLE_PRESETS[role]));
    }
  });
});

describe('console role sets', () => {
  it('ADMIN_CONSOLE_ROLES = the five admin-surface roles (coach + nutrition_admin excluded)', () => {
    assert.deepEqual([...ADMIN_CONSOLE_ROLES], [
      'super_admin',
      'main_admin',
      'member_admin',
      'content_admin',
      'support_admin',
    ]);
    assert.equal(ADMIN_CONSOLE_ROLES.includes('coach'), false);
    assert.equal(ADMIN_CONSOLE_ROLES.includes('nutrition_admin'), false);
  });
  it('COACH_CONSOLE_ROLES = coach + top admins', () => {
    assert.deepEqual([...COACH_CONSOLE_ROLES], ['coach', 'super_admin', 'main_admin']);
  });
});

describe('GRANTABLE_ROLES excludes nutrition_admin (A6) + partner (marketplace wave)', () => {
  it('is STAFF_ROLES minus nutrition_admin and partner', () => {
    assert.equal(GRANTABLE_ROLES.includes('nutrition_admin'), false);
    // partner is minted ONLY via POST /api/admin/partners (which also writes the
    // meal_partners identity row) — never the generic staff-grant path.
    assert.equal(GRANTABLE_ROLES.includes('partner'), false);
    assert.deepEqual(
      [...GRANTABLE_ROLES],
      STAFF_ROLES.filter((r) => r !== 'nutrition_admin' && r !== 'partner'),
    );
  });
  it('still contains every other role', () => {
    for (const role of STAFF_ROLES) {
      if (role === 'nutrition_admin' || role === 'partner') continue;
      assert.equal(GRANTABLE_ROLES.includes(role), true);
    }
  });
});

describe('partner role (marketplace wave)', () => {
  it('preset is exactly meals.own + orders.fulfill', () => {
    assert.deepEqual([...ROLE_PRESETS.partner], ['meals.own', 'orders.fulfill']);
  });
  it('holds its two keys and nothing else', () => {
    assert.equal(hasPermission('partner', 'meals.own'), true);
    assert.equal(hasPermission('partner', 'orders.fulfill'), true);
    for (const perm of ALL_PERMISSIONS) {
      if (perm === 'meals.own' || perm === 'orders.fulfill') continue;
      assert.equal(hasPermission('partner', perm), false, `partner / ${perm}`);
    }
  });
  it('never opens the admin or coach console', () => {
    assert.equal(ADMIN_CONSOLE_ROLES.includes('partner'), false);
    assert.equal(COACH_CONSOLE_ROLES.includes('partner'), false);
  });
});

describe('marketplace admin keys sit in NO sub-role preset (super/main bypass only)', () => {
  const superMainOnly: Permission[] = ['partners.manage', 'orders.review', 'gyms.manage'];
  it('only the bypass roles hold them', () => {
    for (const perm of superMainOnly) {
      for (const role of STAFF_ROLES) {
        const expected = role === 'super_admin' || role === 'main_admin';
        assert.equal(hasPermission(role, perm), expected, `${role} / ${perm}`);
      }
    }
  });
});

describe('meals.own / orders.fulfill live ONLY on partner (+ bypass)', () => {
  it('no other role carries them', () => {
    for (const perm of ['meals.own', 'orders.fulfill'] as const) {
      for (const role of STAFF_ROLES) {
        const expected =
          role === 'partner' || role === 'super_admin' || role === 'main_admin';
        assert.equal(hasPermission(role, perm), expected, `${role} / ${perm}`);
      }
    }
  });
});
