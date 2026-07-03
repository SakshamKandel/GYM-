/**
 * Minimal Groq chat-completions client.
 * Uses EXPO_PUBLIC_GROQ_API_KEY so the key is bundled at build time.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const MODEL = 'llama-3.3-70b-versatile';

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
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

// ════════════════════════════════════════════════════════════════
// AI Greece coach (on-device)
//
// The Elite coach reply is generated HERE, on the phone, using the bundled
// EXPO_PUBLIC_GROQ_API_KEY — so it works the moment the app installs with no
// server key. The server just persists whatever we generate (and keeps its
// own GROQ_API_KEY reply path as an optional fallback). Mirrors the persona
// in apps/web/src/lib/groqCoach.ts so replies read identically either way.
// ════════════════════════════════════════════════════════════════

/** Which coach thread we're replying in — matches CoachThreadKind. */
export type CoachAiKind = 'coach_chat' | 'support';

/** One prior turn, oldest → newest, with the latest user message included. */
export interface CoachAiTurn {
  sender: 'user' | 'coach';
  body: string;
}

/** Build Greece's persona system prompt for the given thread + member. */
function coachPersona(kind: CoachAiKind, name: string): string {
  const who = name.trim() || 'this athlete';
  if (kind === 'coach_chat') {
    return [
      `You are Greece Maharjan, a respected Nepali strength and physique coach and founder of the GM Method.`,
      `You are coaching ${who}, a paying Elite member, one-on-one over chat.`,
      `Reply like a real coach: direct, warm but no-nonsense, specific and practical.`,
      `Give actionable guidance on training, nutrition, recovery, and mindset, and address them by name when it feels natural.`,
      `Keep replies short — 2 to 4 sentences, plain language, no clichés.`,
      `An occasional natural Nepali word is fine. Do not diagnose injuries or give medical advice — for real pain, tell them to see a professional.`,
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
 * Generate the coach's reply on-device from the thread history (oldest →
 * newest, the latest user message included). Maps the last ~12 turns to Groq
 * messages (user → user, coach → assistant) behind Greece's persona and calls
 * groqChat. Returns null on any failure so the caller can persist the user
 * message alone and let the server auto-ack.
 */
export async function coachReplyAI(
  kind: CoachAiKind,
  name: string,
  history: CoachAiTurn[],
): Promise<string | null> {
  const messages: GroqMessage[] = [{ role: 'system', content: coachPersona(kind, name) }];
  // Only the last dozen turns matter; keeps the prompt small and cheap.
  for (const turn of history.slice(-12)) {
    const body = turn.body.trim();
    if (body.length === 0) continue;
    messages.push({ role: turn.sender === 'user' ? 'user' : 'assistant', content: body });
  }

  const reply = await groqChat(messages, { temperature: 0.7, maxTokens: 220 });
  const trimmed = reply?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
