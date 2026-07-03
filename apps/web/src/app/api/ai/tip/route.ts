import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { groqComplete } from '@/lib/groq';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Short AI coach tips (Home + Progress). Generated SERVER-SIDE with the
 * server's GROQ_API_KEY so no key ships in the app.
 *
 * Auth-gated (any signed-in tier) so this can't be used as an open Groq proxy,
 * and the prompt is size-capped so it can't be abused as a large-context LLM.
 * The client sends the pre-built {role, content} messages; we force a small
 * token budget and return { text } (null when Groq is unavailable — the tip
 * card degrades to a quiet "unavailable" line).
 */

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().min(1).max(2000),
});

const postSchema = z.object({
  messages: z.array(messageSchema).min(1).max(8),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { messages } = parsed.data;

  // Guardrail: cap the total prompt so this endpoint can't be abused as a
  // large-context LLM. Tips are tiny by design.
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars > 4000) return json({ error: 'invalid' }, 400);

  const text = await groqComplete(messages, { temperature: 0.8, maxTokens: 150 });
  return json({ text: text ?? null }, 200);
}
