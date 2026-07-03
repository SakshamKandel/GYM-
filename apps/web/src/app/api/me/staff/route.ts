import { bearerToken, staffForToken, type StaffRole } from '@/lib/auth';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Staff-role probe for a signed-in mobile client.
 *
 *  GET /api/me/staff
 *    → { role: StaffRole | null }
 *
 * Any signed-in user may call this (bearer auth). It resolves the caller's
 * bearer token to a staff principal via staffForToken and returns their role,
 * or null when the token maps to a non-staff account. The mobile app uses this
 * to decide whether to surface the staff console at all.
 *
 * Missing/empty bearer → 401. A valid token that is simply not a staff account
 * is NOT an error: it returns 200 { role: null } so the client can render the
 * plain member experience.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);

  const staff = await staffForToken(token);
  const role: StaffRole | null = staff?.role ?? null;
  return json({ role }, 200);
}
