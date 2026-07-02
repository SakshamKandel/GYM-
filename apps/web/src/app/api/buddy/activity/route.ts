import { buddyActivity } from '@gym/db';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

// Per-type payload schemas: unknown keys are stripped, strings capped, numbers
// bounded so buddies can't stuff garbage into each other's feeds.
const workoutCompletedPayload = z.object({
  name: z.string().max(120).optional(),
  date: z.string().max(32).optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  volumeKg: z.number().min(0).max(1_000_000).optional(),
  prCount: z.number().int().min(0).max(1_000).optional(),
});

const prPayload = z.object({
  exercise: z.string().max(120).optional(),
  weightKg: z.number().min(0).max(10_000).optional(),
  reps: z.number().int().min(0).max(10_000).optional(),
  date: z.string().max(32).optional(),
});

const bodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workout_completed'), payload: workoutCompletedPayload }),
  z.object({ type: z.literal('pr'), payload: prPayload }),
]);

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  // targetId null = broadcast: visible to all accepted buddies.
  await getDb().insert(buddyActivity).values({
    accountId: me.id,
    type: parsed.data.type,
    targetId: null,
    payload: parsed.data.payload,
  });

  return json({ ok: true }, 201);
}
