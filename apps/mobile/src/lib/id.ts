/** Collision-safe-enough local IDs (offline-first; server IDs come later with Supabase). */
export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
