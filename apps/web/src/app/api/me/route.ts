import { bearerToken, userForToken } from '@/lib/auth';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);

  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  return json({ user }, 200);
}
