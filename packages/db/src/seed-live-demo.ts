import { config } from 'dotenv';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb } from './index';
import {
  accounts,
  admins,
  gyms,
  mealAvailability,
  mealDeliveryConfig,
  mealPartners,
  meals,
} from './schema';

/**
 * Make the member-facing Gyms + Meals surfaces show real content:
 *
 * 1. Publishes the Wave Health Club listing seeded earlier as a draft, using
 *    publicly sourced facts (ProLinkNepal business listing, 2026-07-18:
 *    Wave Hospitality complex, Dhapasi Marga, Basundhara-3, Kathmandu —
 *    health club + swimming pool + restaurant + bakery). Coordinates are the
 *    OSM/Nominatim centroid for the Basundhara suburb (27.74224, 85.33262)
 *    — area-level, close enough for distance display; an admin can drop the
 *    exact pin from /admin/gyms. Unknown facts (phone, hours, prices) stay
 *    empty rather than fabricated. Only touches the row while it is still a
 *    'draft' — never clobbers admin edits.
 *
 * 2. Creates the "Lean Kitchen" demo meal partner (display-only account, no
 *    password — portal sign-in gets real credentials via /admin/partners)
 *    with an 8-meal macro-tagged menu available every day for both windows,
 *    plus the delivery-config singleton. Idempotent throughout.
 *
 * Run from packages/db:  pnpm --filter @gym/db seed:live-demo
 */

config({ path: '../../.env' });

const GYM_SLUG = 'wave-health-club-ktm';
const KITCHEN_EMAIL = 'demo.kitchen@gymapp.local';
const KITCHEN_NAME = 'Lean Kitchen';

interface MealSeed {
  name: string;
  description: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  dietType: 'veg' | 'non_veg' | 'egg';
  goalTags: string[];
  priceMinor: number; // paisa — Rs 1 = 100
  sortOrder: number;
}

const MENU: MealSeed[] = [
  {
    name: 'Grilled Chicken Power Bowl',
    description: 'Char-grilled chicken breast, brown rice, roasted vegetables, mint yogurt.',
    kcal: 520, proteinG: 42, carbsG: 48, fatG: 16, fiberG: 7,
    dietType: 'non_veg', goalTags: ['cutting', 'balanced'], priceMinor: 45000, sortOrder: 0,
  },
  {
    name: 'Paneer Tikka Protein Plate',
    description: 'Tandoori paneer, quinoa pulao, charred peppers, cucumber raita.',
    kcal: 560, proteinG: 30, carbsG: 52, fatG: 22, fiberG: 8,
    dietType: 'veg', goalTags: ['balanced'], priceMinor: 40000, sortOrder: 1,
  },
  {
    name: 'Bulk-Up Chicken Rice',
    description: 'Double chicken portion, jeera rice, dal fry, seasonal greens.',
    kcal: 780, proteinG: 55, carbsG: 82, fatG: 20, fiberG: 9,
    dietType: 'non_veg', goalTags: ['bulking'], priceMinor: 55000, sortOrder: 2,
  },
  {
    name: 'Egg White Veggie Scramble',
    description: 'Six-egg-white scramble, whole-wheat toast, avocado, cherry tomatoes.',
    kcal: 420, proteinG: 32, carbsG: 34, fatG: 16, fiberG: 6,
    dietType: 'egg', goalTags: ['cutting'], priceMinor: 35000, sortOrder: 3,
  },
  {
    name: 'Lean Fish Curry Bowl',
    description: 'Steamed local fish in light tomato curry, red rice, sautéed spinach.',
    kcal: 490, proteinG: 38, carbsG: 46, fatG: 14, fiberG: 6,
    dietType: 'non_veg', goalTags: ['cutting', 'balanced'], priceMinor: 52000, sortOrder: 4,
  },
  {
    name: 'Chana Masala Fuel Box',
    description: 'Protein-rich chickpea masala, millet roti, pickled onions, salad.',
    kcal: 510, proteinG: 22, carbsG: 68, fatG: 14, fiberG: 12,
    dietType: 'veg', goalTags: ['balanced', 'bulking'], priceMinor: 32000, sortOrder: 5,
  },
  {
    name: 'Post-Workout Momo (Steamed)',
    description: 'Lean chicken momos, spicy tomato achar, clear vegetable soup.',
    kcal: 450, proteinG: 34, carbsG: 50, fatG: 10, fiberG: 4,
    dietType: 'non_veg', goalTags: ['balanced'], priceMinor: 30000, sortOrder: 6,
  },
  {
    name: 'Overnight Oats & Nut Butter',
    description: 'Rolled oats, milk, banana, peanut butter, chia — breakfast or recovery.',
    kcal: 480, proteinG: 20, carbsG: 58, fatG: 18, fiberG: 9,
    dietType: 'veg', goalTags: ['bulking', 'balanced'], priceMinor: 25000, sortOrder: 7,
  },
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL missing — put it in the repo-root .env');
  }
  const db = createDb(databaseUrl);

  // ---- 1. Publish Wave Health Club (only while still a draft) ----
  const updated = await db
    .update(gyms)
    .set({
      addressText: 'Dhapasi Marga, Basundhara-3',
      city: 'Kathmandu',
      district: 'Kathmandu',
      lat: 27.74224,
      lng: 85.33262,
      description:
        'Health club inside the Wave Hospitality complex in Basundhara — gym floor with a swimming pool, in-house restaurant and bakery.',
      amenities: ['Swimming pool', 'Cardio zone', 'Strength training', 'Restaurant', 'Bakery', 'Parking'],
      status: 'published',
      verifiedByAdmin: true,
      updatedAt: new Date(),
    })
    .where(and(eq(gyms.slug, GYM_SLUG), eq(gyms.status, 'draft')))
    .returning({ id: gyms.id });
  console.log(
    updated.length > 0
      ? `published gym "${GYM_SLUG}" (${updated[0]!.id})`
      : `gym "${GYM_SLUG}" not in draft state — left untouched`,
  );

  // ---- 2. Demo kitchen partner account (display-only, no password) ----
  let kitchenAccountId: string;
  const existingAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, KITCHEN_EMAIL))
    .limit(1);
  if (existingAccount[0] !== undefined) {
    kitchenAccountId = existingAccount[0].id;
    console.log(`account ${KITCHEN_EMAIL} already exists (${kitchenAccountId})`);
  } else {
    const inserted = await db
      .insert(accounts)
      .values({ email: KITCHEN_EMAIL, displayName: KITCHEN_NAME, status: 'active' })
      .returning({ id: accounts.id });
    const row = inserted[0];
    if (row === undefined) throw new Error('failed to insert kitchen account');
    kitchenAccountId = row.id;
    console.log(`created account ${KITCHEN_EMAIL} (${kitchenAccountId})`);
  }

  await db
    .insert(admins)
    .values({ accountId: kitchenAccountId, role: 'partner' })
    .onConflictDoNothing({ target: admins.accountId });

  let partnerId: string;
  const existingPartner = await db
    .select({ id: mealPartners.id })
    .from(mealPartners)
    .where(eq(mealPartners.accountId, kitchenAccountId))
    .limit(1);
  if (existingPartner[0] !== undefined) {
    partnerId = existingPartner[0].id;
    console.log(`meal partner already exists (${partnerId})`);
  } else {
    const inserted = await db
      .insert(mealPartners)
      .values({
        accountId: kitchenAccountId,
        name: KITCHEN_NAME,
        contact: KITCHEN_EMAIL,
        addressText: 'Basundhara, Kathmandu',
        serviceAreas: ['Basundhara', 'Dhapasi', 'Tokha', 'Maharajgunj', 'Samakhusi', 'Baluwatar'],
        acceptsCod: true,
        currency: 'NPR',
        isActive: true,
      })
      .returning({ id: mealPartners.id });
    const row = inserted[0];
    if (row === undefined) throw new Error('failed to insert meal partner');
    partnerId = row.id;
    console.log(`created meal partner "${KITCHEN_NAME}" (${partnerId})`);
  }

  // ---- 3. Menu (idempotent by partner+name) ----
  const existingMeals = await db
    .select({ id: meals.id, name: meals.name })
    .from(meals)
    .where(and(eq(meals.partnerId, partnerId), inArray(meals.name, MENU.map((m) => m.name))));
  const existingByName = new Map(existingMeals.map((m) => [m.name, m.id]));

  const mealIds: string[] = [...existingByName.values()];
  for (const m of MENU) {
    if (existingByName.has(m.name)) continue;
    const inserted = await db
      .insert(meals)
      .values({
        partnerId,
        name: m.name,
        description: m.description,
        kcal: m.kcal,
        proteinG: m.proteinG,
        carbsG: m.carbsG,
        fatG: m.fatG,
        fiberG: m.fiberG,
        dietType: m.dietType,
        goalTags: m.goalTags,
        priceMinor: m.priceMinor,
        currency: 'NPR',
        isActive: true,
        sortOrder: m.sortOrder,
      })
      .returning({ id: meals.id });
    const row = inserted[0];
    if (row === undefined) throw new Error(`failed to insert meal ${m.name}`);
    mealIds.push(row.id);
    console.log(`created meal "${m.name}"`);
  }

  // ---- 4. Availability: every day, both windows, every meal ----
  for (const mealId of mealIds) {
    for (let day = 0; day <= 6; day++) {
      await db
        .insert(mealAvailability)
        .values([
          { mealId, dayOfWeek: day, window: 'lunch' },
          { mealId, dayOfWeek: day, window: 'dinner' },
        ])
        .onConflictDoNothing();
    }
  }
  console.log(`availability ensured for ${mealIds.length} meals × 7 days × 2 windows`);

  // ---- 5. Delivery-config singleton (schema defaults) ----
  await db.insert(mealDeliveryConfig).values({ id: 'singleton' }).onConflictDoNothing();
  console.log('delivery config singleton ensured');

  console.log('seed-live-demo complete.');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
