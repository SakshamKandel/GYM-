import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDb } from '../index';
import { exercises } from '../schema';

/**
 * Seed the `exercises` catalog from the bundled free-exercise-db dataset
 * (WP-9 — video pipeline repair).
 *
 * WHY THIS EXISTS: `plan_videos.exercise_id` has a FK to `exercises(id)`, but
 * the table shipped empty — the app reads its exercise library from the bundled
 * JSON asset, not this table. So attaching a video to any real member-visible
 * exercise raised a 23503 FK violation and no video ever reached members. This
 * script upserts the SAME 873-exercise catalog (identical ids — the canonical
 * free-exercise-db slug space, contract C-G) the mobile app bundles, so those
 * FKs resolve.
 *
 * SOURCE OF TRUTH: apps/mobile/assets/data/exercises.json — the single bundled
 * copy the mobile Train tab reads. We read it directly rather than duplicating
 * the ~1MB payload so the seed can never drift from what members actually see.
 *
 * Idempotent: keyed by id with ON CONFLICT DO UPDATE, so re-running refreshes
 * names/muscles/images in place and never duplicates. Safe to run after every
 * `db:push`.
 *
 * Run from packages/db:  pnpm --filter @gym/db seed:exercises
 */

config({ path: '../../.env' });

const CDN = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';

interface RawExercise {
  id: string;
  name: string;
  level: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string | null;
  images: string[];
}

/** Mirror of apps/mobile/src/lib/exercises.ts `normalize` → the DB row shape. */
function toRow(raw: RawExercise) {
  return {
    id: raw.id,
    name: raw.name,
    muscleGroup: raw.primaryMuscles[0] ?? 'other',
    secondaryMuscles: raw.secondaryMuscles ?? [],
    equipment: raw.equipment || null,
    level: raw.level || null,
    category: raw.category || null,
    instructions: raw.instructions ?? [],
    imageUrls: (raw.images ?? []).map((p) => `${CDN}${p}`),
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (expected in repo-root .env)');
  }

  const here = dirname(fileURLToPath(import.meta.url));
  // packages/db/src/seed → repo root is four levels up.
  const jsonPath = resolve(here, '../../../../apps/mobile/assets/data/exercises.json');
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as RawExercise[];
  const rows = raw.map(toRow);

  const db = createDb(databaseUrl);

  // Upsert in chunks — neon-http sends one HTTP request per statement, so batch
  // rows into multi-value inserts to keep the run to a handful of round-trips.
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await db
      .insert(exercises)
      .values(batch)
      .onConflictDoUpdate({
        target: exercises.id,
        set: {
          name: sql`excluded.name`,
          muscleGroup: sql`excluded.muscle_group`,
          secondaryMuscles: sql`excluded.secondary_muscles`,
          equipment: sql`excluded.equipment`,
          level: sql`excluded.level`,
          category: sql`excluded.category`,
          instructions: sql`excluded.instructions`,
          imageUrls: sql`excluded.image_urls`,
        },
      });
    written += batch.length;
  }

  console.log(`Seeded ${written} exercises from ${jsonPath}`);
}

main().catch((err) => {
  console.error('exercises seed failed:', err);
  process.exitCode = 1;
});
