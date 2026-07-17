import { deleteSession, staffForToken } from '@/lib/auth';
import { logAudit } from '@/lib/authz';
import { json, preflight } from '@/lib/http';
import { clientIp } from '@/lib/rateLimit';
import { clearStaffCookie, staffTokenFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

/** Deletes the session server-side and clears the 'gt_staff' cookie. */
export async function POST(req: Request) {
  const token = await staffTokenFromCookie();
  if (token) {
    // Resolve the actor BEFORE deleting the session so the logout is
    // attributable (A8); a non-staff/expired token simply skips the audit row.
    const staff = await staffForToken(token);
    await deleteSession(token);
    if (staff) {
      await logAudit({ id: staff.user.id }, 'staff.logout', 'account', staff.user.id, {}, clientIp(req));
    }
  }
  await clearStaffCookie();
  return json({ ok: true }, 200);
}
