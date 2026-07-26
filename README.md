# 🏋️ GYM Tracker

A coach-branded fitness platform. Members train, eat and track on iOS and
Android (Expo React Native). Everything behind them (the marketing site, the
member API, and the admin, coach and restaurant-partner consoles) is one
Next.js app on Neon Postgres.

> Deploy + bootstrap: [docs/DEPLOY.md](docs/DEPLOY.md) · Engineering rules:
> [CLAUDE.md](CLAUDE.md) · Mobile UI language:
> [apps/mobile/DESIGN-BRIEF.md](apps/mobile/DESIGN-BRIEF.md) · Marketing design
> system: [apps/web/src/components/marketing/SPEC.md](apps/web/src/components/marketing/SPEC.md)
>
> [PROJECT_PLAN.md](PROJECT_PLAN.md) is the original 2026-07-03 plan, kept for
> history. Do not build from it.

## What is in it

**Members** get six tabs: Home, Train, Food, Meals, Gyms, Progress.

- **Train** — plans, workout logger, Gym Mode, rest timer, plate calculator, PR
  detection, and a real 3D anatomy viewer for picking muscles.
- **Food** — kcal and macro tracking, food search and barcode scan, water,
  custom foods, food-quality signals.
- **Progress** — weight with EWMA trend smoothing, measurements, progress
  photos with a compare slider, streaks, PR moments.
- **Coaching** — browse coaches, request one, chat, and follow the workouts and
  diet plans they assign.
- **Meals** — order and subscribe to prepared meals from partner restaurants.
- **Gyms** — a directory of nearby gyms with day passes and enquiries.

**Staff** get three web consoles: `/admin` (members, money, content,
moderation, support, analytics), `/coach` (clients, plans, milestones,
wallet), and `/partner` (a restaurant's own orders and menu, and nothing else).

## Monorepo structure

```
apps/
  mobile/          Expo SDK 57 app (expo-router, TypeScript strict)
  web/             Next.js 15 App Router — marketing site, member API,
                   and the admin / coach / partner consoles
packages/
  shared/          Domain types, zod schemas and pure logic (PR detection,
                   trend smoothing, macro math, entitlements, order state,
                   permissions) — unit tested
  ui-tokens/       Design tokens: charcoal surfaces, signal-red accent,
                   Poppins + Oswald type scale
  db/              Drizzle schema, client and seeds for Neon Postgres
                   (the cloud source of truth)
```

## Stack

| Layer | Choice |
|---|---|
| Mobile | React Native · Expo SDK 57 · expo-router · TypeScript strict |
| Web | Next.js 15 App Router · React 19 · Node 22 |
| Cloud DB | **Neon Postgres** via Drizzle (`packages/db`, schema pushed from `src/schema.ts`) |
| Access control | API layer only. Every route guards through `@/lib/authz`, scopes by account, fails closed and audits mutations. No row-level security |
| Local data | expo-sqlite, offline-first: every log lands locally first, then syncs |
| State | Zustand, persisted through encrypted MMKV on device |
| Mobile styling | StyleSheet + `@gym/ui-tokens` (no runtime CSS deps) |
| Web styling | Tailwind v4 for the marketing site (scoped under `.mkt`), CSS tokens in `globals.css` for the consoles |
| Payments | RevenueCat for the stores, plus a manual receipt rail for Nepal |
| Email | Resend, behind one seam at `apps/web/src/lib/email/` |
| Push | Firebase Cloud Messaging server side, expo-notifications on device |
| Media | Cloudinary, authenticated delivery for receipts and progress photos |
| Food data | **Open Food Facts** (free, no key) + optional USDA FoodData Central |
| Exercise library | **free-exercise-db** — 873 exercises seeded into Neon, images via jsDelivr CDN |

## Getting started

```bash
pnpm install
```

Then bring up a database. The app needs one: the exercise catalog, plans,
accounts and everything else live in Neon, and the mobile app reaches them only
through the web API.

```bash
cp .env.example .env                          # put your Neon DATABASE_URL in it
pnpm --filter @gym/db db:push                 # build the schema
pnpm --filter @gym/db seed:exercises          # 873 exercises
pnpm --filter @gym/db seed:training-catalog   # the three launch plans
SEED_STAFF_EMAIL=you@example.com SEED_STAFF_PASSWORD='a long passphrase' \
  pnpm --filter @gym/db seed:staff            # the first super admin
```

Full explanation of each step, and what happens if you skip one, is
[docs/DEPLOY.md §0](docs/DEPLOY.md).

Now run them:

```bash
pnpm dev                             # web + API on http://localhost:3055
cd apps/mobile && npx expo start     # scan the QR with Expo Go, or press w for web
```

Point the app at your machine with `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3055`.
Without it the app falls back to port 3000 and reaches nothing.

## Scripts

```bash
pnpm typecheck && pnpm lint && pnpm test   # every workspace, run before committing
pnpm --filter @gym/shared test             # domain logic only (node:test, zero deps)
pnpm --filter web test                     # API and lib tests
```

## Design language

Dark charcoal (#131416) with a single signal-red accent, friendly rounded
headings (Poppins) over condensed stat numerals (Oswald), pill chips, rounded
tiles, floating tab bar. Red means "act now / today / PR". Nothing glows,
pulses, or blurs. The web consoles run the opposite way: a light SaaS shell
with the same red as its one accent.

## Data sources & licenses

- [Open Food Facts](https://world.openfoodfacts.org) — food & barcode data (ODbL)
- [free-exercise-db](https://github.com/yuhonas/free-exercise-db) — exercise library (Unlicense/public domain)
- Z-Anatomy + BodyParts3D — the 3D anatomy model. Share-Alike; full wording and
  the list of modifications are in `apps/mobile/assets/anatomy/ATTRIBUTION.md`

## License

[MIT](LICENSE) © Saksham Kandel
