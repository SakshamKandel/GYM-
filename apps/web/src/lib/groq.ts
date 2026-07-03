/**
 * Server-side Groq chat client. The key (GROQ_API_KEY) lives ONLY on the
 * server so it never ships in the app bundle — every AI feature (coach replies,
 * short tips) routes through here.
 *
 * Returns null on any failure (missing key, network, timeout, parse) so callers
 * fall back gracefully instead of surfacing an error.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 12_000;

export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function groqComplete(
  messages: GroqChatMessage[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
