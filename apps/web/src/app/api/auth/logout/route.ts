import { bearerToken, deleteSession } from '@/lib/auth';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  await deleteSession(token);
  return json({ ok: true }, 200);
}
