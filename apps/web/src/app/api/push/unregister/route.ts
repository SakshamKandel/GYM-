import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { json, preflight, readJson } from '@/lib/http';
import { unregisterToken } from '@/lib/push';

export const runtime = 'nodejs';

const bodySchema = z.object({
  token: z.string().min(1),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  await unregisterToken(me.id, parsed.data.token);
  return json({ ok: true }, 200);
}
