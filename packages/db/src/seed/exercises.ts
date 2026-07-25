import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDb } from '../index';
import { exercises } from '../schema';

/**
 * One-time import of the free-exercise-db dataset into the `exercises` table.
 *
 * SOURCE OF TRUTH: the `exercises` table in Neon. Members read it through the
 * authenticated training-catalog endpoint (GET /api/me/training-catalog), and
 * staff edit it in the admin catalog (/admin/catalog). The app does NOT ship an
 * exercise list of its own — apps/mobile/src/lib/exercises.ts re-exports the
 * Neon-backed catalog, so anything not in this table is invisible to members.
 *
 * ./data/exercises.json is an import FIXTURE, not a live data source. It is the
 * upstream free-exercise-db snapshot, kept only so the table can be populated
 * (or repopulated) from a known-good starting point. Edits made in the admin
 * catalog do not flow back into it, and re-running this seed will overwrite
 * those edits for any id present in the fixture.
 *
 * IDS ARE A CONTRACT: the seeded ids are the canonical free-exercise-db slugs
 * (contract C-G). `plan_videos.exercise_id` and other rows carry foreign keys
 * to them, and PR detection joins on them, so ids must stay byte-identical
 * across re-imports — never regenerate or renumber them.
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

/** Map one free-exercise-db fixture entry onto the `exercises` row shape. */
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
  // Import fixture sits next to this script: packages/db/src/seed/data/.
  const jsonPath = resolve(here, 'data/exercises.json');
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
