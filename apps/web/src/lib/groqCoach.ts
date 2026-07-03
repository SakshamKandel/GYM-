/**
 * AI "Greece" coach reply generation. Runs SERVER-SIDE (via lib/groq, which
 * holds GROQ_API_KEY) so the key never ships in the app bundle.
 *
 * This is the INTERIM coach: an AI in Greece Maharjan's voice answers Elite
 * members instantly. When the coach admin panel ships, the real Greece's
 * replies replace these — the thread + persistence stay the same.
 */

import { groqComplete, type GroqChatMessage } from './groq';

export type CoachKind = 'coach_chat' | 'support';

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
  const messages: GroqChatMessage[] = [{ role: 'system', content: persona(kind, name) }];
  // Only the last dozen turns matter; keeps the prompt small and cheap.
  for (const m of history.slice(-12)) {
    messages.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.body });
  }
  return groqComplete(messages, { temperature: 0.7, maxTokens: 220 });
}
