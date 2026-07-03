/**
 * Minimal Groq chat-completions client.
 * Uses EXPO_PUBLIC_GROQ_API_KEY so the key is bundled at build time.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const MODEL = 'llama-3.3-70b-versatile';

export interface GroqMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Send a chat completion request to Groq and return the text response.
 * Returns null on any error (network, auth, parse) so callers can fall back silently.
 */
export async function groqChat(
  messages: GroqMessage[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string | null> {
  if (!GROQ_KEY) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.maxTokens ?? 200,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}
