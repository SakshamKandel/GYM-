/**
 * Server-side Groq chat client. The key (GROQ_API_KEY) lives ONLY on the
 * server so it never ships in the app bundle. The coach tip is the one feature
 * that routes through here.
 *
 * Returns null on any failure (network, timeout, bad status, parse) so callers
 * fall back gracefully instead of surfacing an error. A MISSING KEY is a
 * different animal: callers should ask {@link isGroqConfigured} first so a
 * deployment that was never given a key is distinguishable from a provider
 * having a bad afternoon.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

/**
 * Default give-up time. Callers on a mobile-facing path MUST pass something
 * shorter than the app's own 10s request timeout, so the server is always the
 * one that gives up first and can answer with a clean empty state instead of
 * leaving the phone to time out on silence.
 */
const TIMEOUT_MS = 8_000;

export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** True when this deployment actually has a provider key. */
export function isGroqConfigured(): boolean {
  return (process.env.GROQ_API_KEY ?? '').trim().length > 0;
}

export async function groqComplete(
  messages: GroqChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<string | null> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.maxTokens ?? 200,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const jsonBody = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = jsonBody.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
