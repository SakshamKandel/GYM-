import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { createDb } from './index';
import { gyms } from './schema';

/**
 * Seed the "Wave Health Club" placeholder gym listing (plan §4 — VERBATIM
 * seed object). Every field the plan marks unconfirmed stays null/empty —
 * nothing here is fabricated. Google Maps extraction was BLOCKED by a
 * bot-detection interstitial (2026-07-17), not bypassed, so address/phone/
 * hours/rating/amenities are unknown until an admin fills them in through
 * the /admin/gyms CRUD (which is also the only place photos get attached —
 * this seed intentionally leaves `externalImageUrl` null and adds zero
 * photos; NEVER scrape/hotlink Google Maps images).
 *
 * Ships `status:'draft', verifiedByAdmin:false` — invisible on the public
 * /api/gyms surface until an admin confirms real details and publishes it.
 *
 * Idempotent by slug: re-running is a safe no-op once the row exists (an
 * admin may have since edited it — this script must never clobber that).
 *
 * Run from packages/db (DATABASE_URL comes from the repo-root .env, same as
 * drizzle.config.ts):  pnpm --filter @gym/db seed:wave-gym
 */

config({ path: '../../.env' });

const SLUG = 'wave-health-club-ktm';

const SOURCE_NOTE =
  'Seed placeholder — Google Maps extraction blocked by bot-detection interstitial ' +
  '(2026-07-17); values require admin confirmation before going live.';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL missing — put it in the repo-root .env');
  }
  const db = createDb(databaseUrl);

  const existing = await db.select({ id: gyms.id }).from(gyms).where(eq(gyms.slug, SLUG)).limit(1);
  if (existing.length > 0) {
    console.log(`gym "${SLUG}" already exists (${existing[0]!.id}) — leaving it untouched.`);
    return;
  }

  const inserted = await db
    .insert(gyms)
    .values({
      slug: SLUG,
      name: 'Wave Health Club', // from a share-link query only — unverified against a live listing
      category: 'gym',
      addressText: '', // NOT extractable — needs manual admin entry
      city: 'Kathmandu', // unverified
      district: '',
      lat: null,
      lng: null,
      phone: '', // NOT extractable
      website: null,
      socialLinks: [],
      hours: {}, // NOT extractable — model as { mon: [...], … } once known
      amenities: [], // illustrative placeholders were NOT sourced — leave empty until confirmed
      externalImageUrl: null,
      priceNote: '', // from review mentions, once available
      description: SOURCE_NOTE,
      rating: null,
      reviewCount: null,
      status: 'draft',
      verifiedByAdmin: false,
      createdBy: null,
      lastEditedBy: null,
    })
    .onConflictDoNothing({ target: gyms.slug })
    .returning({ id: gyms.id });

  const row = inserted[0];
  if (!row) {
    console.log(`gym "${SLUG}" was created concurrently — nothing to do.`);
    return;
  }

  console.log(`created draft gym "${SLUG}" (${row.id}).`);
  console.log('Fill in real details and mark verified via /admin/gyms before publishing.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
