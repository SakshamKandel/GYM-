/**
 * Client types for the coach video library. Mirrors the projection
 * GET /api/coach/videos returns — the same plan_videos rows the admin content
 * section manages, but carrying `views` (engagement) and the attached
 * `exercise` (id + name, or null), and INCLUDING removed rows so the coach can
 * see history. The upload/retier/remove mutations reuse the admin video routes
 * (coach holds content.video.publish), so we reuse the admin `VideoDetail`
 * shape those routes return.
 */

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';
export type VideoStatus = 'processing' | 'ready' | 'removed';

/** Tier options in ascending order — labels for the tier <select>. */
export const TIERS: readonly Tier[] = ['starter', 'silver', 'gold', 'elite'];

/** The attached exercise, when the video is exercise-level (else null). */
export interface VideoExercise {
  id: string;
  name: string | null;
}

/** Row shape the coach library table renders (from GET /api/coach/videos). */
export interface CoachVideoRow {
  id: string;
  title: string;
  tierRequired: Tier;
  status: VideoStatus;
  position: number;
  thumbnailUrl: string | null;
  views: number;
  exercise: VideoExercise | null;
  createdAt: string;
}
