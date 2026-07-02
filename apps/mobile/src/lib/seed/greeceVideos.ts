/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GREECE'S EXERCISE DEMO VIDEOS  —  the coach content that sells the Gold tier.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is where Greece's own demo clips get wired into the app. Each entry maps
 * ONE exercise (by its free-exercise-db id) to ONE hosted video. When an entry
 * exists here, Gold members see Greece's video on that exercise's detail screen;
 * everyone else sees a locked "Greece's demo" card or a "coming soon" chip.
 *
 * ── HOW TO ADD YOUR FIRST DEMO VIDEO (2 steps) ──────────────────────────────
 *
 *  1. Find the exercise id.
 *     The id is the exact key used in the seed plans (src/lib/seed/plans.ts) —
 *     e.g. the back squat is  'Barbell_Squat', the bench press is
 *     'Barbell_Bench_Press_-_Medium_Grip', the deadlift is 'Barbell_Deadlift'.
 *     Match it letter-for-letter, including the underscores and capitals.
 *
 *  2. Host the video and paste its https URL.
 *     Upload the clip somewhere that serves a direct, public https link — the
 *     same Vercel project / CDN the rest of the app uses is ideal, but any plain
 *     `.mp4` link works (Cloudflare Stream, Bunny, S3, Mux, etc.).
 *       • Use a direct file/stream URL, NOT a YouTube / Instagram page link.
 *       • `.mp4` (H.264) plays everywhere. `.m3u8` (HLS) also works for
 *         adaptive streaming — expo-video handles both natively.
 *       • Keep clips short (10–20s), shot in decent light, filmed vertically or
 *         square so they sit nicely in the rounded video block.
 *
 *     Then add one line to GREECE_VIDEOS below:
 *         Barbell_Squat: { url: 'https://cdn.example.com/gm/squat.mp4' },
 *
 *     The optional `label` overrides the caption shown under the player
 *     (defaults to "Greece's demo").
 *
 *  That's it — drop in the URL, reload, and the video "just works". No other
 *  file needs to change.
 *
 * ── NOTE ────────────────────────────────────────────────────────────────────
 *  Ship this EMPTY. As soon as the first real clip is filmed and hosted,
 *  uncomment (or add) its entry. The three commented examples below use real
 *  seed-plan exercise ids so they can be uncommented verbatim once the files
 *  exist at those URLs.
 */

/** One coach demo clip for an exercise. */
export interface GreeceVideo {
  /** Public https URL to a direct .mp4 or .m3u8 (HLS) stream. */
  url: string;
  /** Optional caption under the player. Defaults to "Greece's demo". */
  label?: string;
}

/**
 * Map of free-exercise-db exercise id → Greece's demo clip.
 *
 * Ships EMPTY on purpose. Add entries as Greece films them. Examples below use
 * real seed-plan ids (see src/lib/seed/plans.ts) — swap the placeholder URLs for
 * your hosted files and delete the leading `//` to go live.
 */
export const GREECE_VIDEOS: Record<string, GreeceVideo> = {
  // ── Examples (uncomment once the real files are hosted) ──
  // Barbell_Squat: {
  //   url: 'https://cdn.example.com/gm/back-squat.mp4',
  //   label: "Greece's back squat",
  // },
  // Barbell_Bench_Press_-_Medium_Grip: {
  //   url: 'https://cdn.example.com/gm/bench-press.mp4',
  // },
  // Barbell_Deadlift: {
  //   url: 'https://cdn.example.com/gm/deadlift.mp4',
  //   label: "Greece's conventional deadlift",
  // },
};

/**
 * Returns Greece's demo clip for an exercise, or null if none is wired up yet.
 * The returned object always has a non-empty `url`.
 */
export function getGreeceVideo(exerciseId: string): GreeceVideo | null {
  const video = GREECE_VIDEOS[exerciseId];
  if (!video || video.url.length === 0) return null;
  return video;
}

/** True when Greece has a demo video wired up for this exercise. */
export function hasGreeceVideo(exerciseId: string): boolean {
  return getGreeceVideo(exerciseId) !== null;
}
