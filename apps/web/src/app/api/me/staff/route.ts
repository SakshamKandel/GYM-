import type { Permission } from '@gym/shared';
import { bearerToken, staffForToken, type StaffRole } from '@/lib/auth';
import { effectivePermissionSet } from '@/lib/authz';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Staff-role probe for a signed-in mobile client.
 *
 *  GET /api/me/staff
 *    → { role: StaffRole | null, permissions: Permission[] }
 *
 * Any signed-in user may call this (bearer auth). It resolves the caller's
 * bearer token to a staff principal via staffForToken and returns their role
 * plus the DERIVED permission list (contract §4.3) so the client gates on
 * permissions, never role names. A non-staff token → { role: null,
 * permissions: [] }.
 *
 * Missing/empty bearer → 401. A valid token that is simply not a staff account
 * is NOT an error: it returns 200 { role: null, permissions: [] } so the client
 * can render the plain member experience.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);

  const staff = await staffForToken(token);
  const role: StaffRole | null = staff?.role ?? null;
  if (!staff || !role) return json({ role: null, permissions: [] }, 200);

  let permissions: Permission[];
  try {
    permissions = [
      ...(await effectivePermissionSet({
        id: staff.user.id,
        email: staff.user.email,
        role,
      })),
    ];
  } catch (err) {
    console.error('staff permission resolution failed:', err);
    return json({ error: 'authorization_unavailable' }, 503);
  }
  return json({ role, permissions }, 200);
}
