# 🏋️ GYM Tracker

A coach-brandable fitness app — workout logging, calorie & macro tracking, and body progress, built offline-first for iOS + Android (Expo React Native) with a web/admin surface planned.

> Full product spec: [PROJECT_PLAN.md](PROJECT_PLAN.md) · Engineering rules: [CLAUDE.md](CLAUDE.md) · UI language: [apps/mobile/DESIGN-BRIEF.md](apps/mobile/DESIGN-BRIEF.md)

## Monorepo

```
apps/
  mobile/          Expo SDK 57 app (expo-router, TypeScript strict)
packages/
  shared/          Domain types + pure logic (PR detection, trend smoothing,
                   macro math, streaks, plate calculator) — unit tested
  ui-tokens/       Design tokens: charcoal surfaces, signal-red accent,
                   Poppins + Oswald type scale
  db/              Drizzle ORM schema + client for Neon Postgres (cloud source of truth)
```

## Stack

| Layer | Choice |
|---|---|
| Mobile | React Native · Expo SDK 57 · expo-router · TypeScript strict |
| Local data | expo-sqlite (offline-first; every log lands locally first) |
| Cloud DB | **Neon Postgres** via Drizzle (`packages/db`, schema pushed) |
| State | Zustand (persisted profile/settings) |
| Styling | StyleSheet + `@gym/ui-tokens` (no runtime CSS deps) |
| Food data | **Open Food Facts** — free public API, no key (search + barcode) |
| Exercise library | **free-exercise-db** — 873 exercises bundled (public domain), images via jsDelivr CDN |

## Getting started

```bash
pnpm install
cd apps/mobile
npx expo start          # scan QR with Expo Go (Android) — or press w for web
```

Cloud database (optional for local dev — the app runs fully offline):

```bash
# .env at repo root: DATABASE_URL=postgres://... (Neon)
cd packages/db && pnpm db:push
```

## Scripts

```bash
pnpm --filter @gym/shared test    # unit tests (node:test, zero deps)
cd apps/mobile && npx tsc --noEmit   # strict typecheck
```

## Design language

Dark charcoal (#131416) with a single signal-red accent, friendly rounded headings (Poppins) over condensed stat numerals (Oswald), pill chips, rounded tiles, floating tab bar. Red means "act now / today / PR" — nothing glows, pulses, or blurs.

## Data sources & licenses

- [Open Food Facts](https://world.openfoodfacts.org) — food & barcode data (ODbL)
- [free-exercise-db](https://github.com/yuhonas/free-exercise-db) — exercise library (Unlicense/public domain)

## License

[MIT](LICENSE) © Saksham Kandel
