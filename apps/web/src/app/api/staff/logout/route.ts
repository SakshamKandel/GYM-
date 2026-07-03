import { deleteSession } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { clearStaffCookie, staffTokenFromCookie } from '@/lib/staffSession';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

/** Deletes the session server-side and clears the 'gt_staff' cookie. */
export async function POST() {
  const token = await staffTokenFromCookie();
  if (token) await deleteSession(token);
  await clearStaffCookie();
  return json({ ok: true }, 200);
}
