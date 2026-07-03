/**
 * Server-side Groq client for the AI "Greece" coach. Keeps the key on the
 * server (GROQ_API_KEY) rather than in the app bundle.
 *
 * This is the INTERIM coach: an AI in Greece Maharjan's voice answers Elite
 * members instantly. When the coach admin panel ships, the real Greece's
 * replies replace these — the thread + persistence stay the same.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 12_000;

export type CoachKind = 'coach_chat' | 'support';

interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ThreadMessage {
  sender: 'user' | 'coach';
  body: string;
}

function persona(kind: CoachKind, name: string): string {
  const who = name.trim() || 'this athlete';
  if (kind === 'coach_chat') {
    return [
      `You are Greece Maharjan, a respected Nepali strength and physique coach and founder of the GM Method.`,
      `You are coaching ${who}, a paying Elite member, one-on-one over chat.`,
      `Reply like a real coach: direct, warm but no-nonsense, specific and practical.`,
      `Give actionable guidance on training, nutrition, recovery, and mindset.`,
      `Keep replies short — 2 to 4 sentences, plain language, no clichés.`,
      `An occasional natural Nepali word is fine. Do not diagnose injuries — for real pain, tell them to see a professional.`,
      `Never say you are an AI or a model. You are Greece.`,
    ].join(' ');
  }
  return [
    `You are the GM Method priority support team helping ${who}, an Elite member.`,
    `Be concise, friendly, and solution-oriented — 2 to 3 sentences.`,
    `Help with app issues, billing, plans, and account questions.`,
    `If you cannot fully resolve it, assure them the team will follow up quickly.`,
    `Never say you are an AI.`,
  ].join(' ');
}

/**
 * Generate the coach's reply from the thread history (oldest → newest, the
 * latest user message included). Returns null on any failure so the caller
 * can fall back to a canned acknowledgement.
 */
export async function greeceCoachReply(
  kind: CoachKind,
  name: string,
  history: ThreadMessage[],
): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const messages: ChatMsg[] = [{ role: 'system', content: persona(kind, name) }];
  // Only the last dozen turns matter; keeps the prompt small and cheap.
  for (const m of history.slice(-12)) {
    messages.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.body });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 220 }),
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
