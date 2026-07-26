# FITNESS COACHING APP — ORIGINAL BUILD PLAN (HISTORICAL)

Coach-branded fitness platform · iOS + Android + Web · Built with Claude Code

---

> ## ⚠️ This document is history, not instructions
>
> This is the plan as written on **2026-07-03**, before a line of the app
> existed. It is kept because the reasoning is still worth reading. It is **not
> the architecture source of truth** and several of its biggest calls were
> reversed within days of being made.
>
> **Do not build from this file.** For anything current, use:
>
> | For | Read |
> |---|---|
> | Rules an engineer or agent must follow | `CLAUDE.md` (and `AGENTS.md`) |
> | Bootstrapping, environment, operations | `docs/DEPLOY.md` |
> | The database | `packages/db/src/schema.ts` |
> | Domain logic and contracts | `packages/shared` |
> | What the product actually is today | `README.md` |
>
> **What changed since.** Section 2 below now carries an "as built" table
> alongside the original one. Beyond that: Buddy Sync (section 6.1) was built
> and then **cut** end to end on 2026-07-17, and must not be rebuilt; the
> database has **no row-level security** and is not meant to (section 7 and
> section 8 both say otherwise, see `CLAUDE.md` hard rule 3 for why); the
> folder structure in section 4 never landed as drawn (there is no
> `packages/api-client` and no `supabase/` directory); and the product grew
> three surfaces this plan never imagined, namely meal delivery with a
> restaurant partner portal, a nearby-gyms directory, and a full coach
> mentorship and payout economy.

## 1. WHAT WE ARE BUILDING

A subscription-based fitness coaching app selling branded training methodology:

- Personalized goal engine (plans by subscription tier: Starter / Silver / Gold / Elite)
- Workout logger + Gym Mode (fullscreen, rest timer, plate calculator)
- Weight & body management (trend smoothing, photos, measurements)
- Kcal & macro tracker with regional food database + food suggestions
- Gym Buddy Sync (shared plans, buddy activity, nudges)
- PR celebrations + shareable cards, streaks, challenges
- Coach admin dashboard (web)
- Google (Gmail) login

---

## 2. TECH STACK

### 2a. AS BUILT (this is the accurate one)

| Layer | What actually shipped | Changed from the plan? |
|---|---|---|
| Mobile app | React Native + Expo SDK 57, expo-router, TypeScript strict | No |
| Website + consoles | **Next.js 15** App Router, React 19, Node 22. One app carries the marketing site, the member API, and the admin, coach and partner consoles | Version, and it turned into three consoles rather than one dashboard |
| Backend / DB | **Neon Postgres + Drizzle** (`packages/db`), reached only through `apps/web` API routes | **Yes.** Supabase was dropped on 2026-07-03 |
| Auth | Own email + password against Neon, plus Google and Apple ID-token verification server side. Sessions are bearer tokens minted by `apps/web` | **Yes.** No Supabase Auth |
| Access control | API layer only, via `@/lib/authz`: scoped by account, fail-closed, audited on mutation. **No row-level security anywhere** | **Yes.** RLS would be bypassed by the single owning role in `DATABASE_URL` |
| Local/offline DB | expo-sqlite + a sync queue, through `lib/repo` and `features/sync` | No |
| State | **Zustand only**, persisted through AES-encrypted MMKV with the key in the OS keychain. No TanStack Query | **Yes.** TanStack Query was never added |
| Mobile styling | Plain StyleSheet + `@gym/ui-tokens`. **No NativeWind** | **Yes.** NativeWind v4 pins Tailwind v3 and breaks on SDK upgrades |
| Web styling | Tailwind v4 for the marketing site (scoped under `.mkt`), CSS tokens in `globals.css` for the consoles | Partly |
| Payments | RevenueCat for the stores (webhook is the only thing that grants a tier), plus a manual eSewa/Khalti receipt rail for Nepal and a coach promo/wallet/payout economy | Extended |
| Email | Resend, behind one seam at `apps/web/src/lib/email/` | Not in the plan at all |
| Push notifications | Firebase Cloud Messaging server side via `lib/notify`, expo-notifications on device, with an in-app inbox alongside | Changed |
| Media | Cloudinary, authenticated delivery for receipts and progress photos | Not in the plan |
| Analytics / Crash | **Neither PostHog nor Sentry is installed.** Analytics is computed in-product on `/admin`; there is no crash reporter | **Yes.** Still an open gap |
| Monorepo | Turborepo + pnpm: apps/mobile, apps/web, packages/{shared,ui-tokens,db} | No |

### 2b. As originally decided, 2026-07-03 (superseded, kept for the reasoning)

| Layer | Choice | Why |
|---|---|---|
| Mobile app | **React Native + Expo (TypeScript)** | One codebase → iOS + Android. Expo EAS Build compiles the iOS app **in the cloud, from your Windows PC** — no Mac needed for development. |
| Website + Coach dashboard | **Next.js 14 (App Router, TypeScript)** | Shares types/logic with mobile via monorepo. Marketing site + web login + admin panel. |
| Backend / DB / Auth | **Supabase** (Postgres + Auth + Storage + Realtime) | Google login built-in, Row Level Security, realtime for Buddy Sync, generous free tier, scales to Postgres-anything. |
| Local/offline DB | **SQLite via expo-sqlite + sync layer** | Offline-first: gym basements have no signal. Log locally, sync when online. |
| State | **Zustand** (app state) + **TanStack Query** (server state) | Simple, fast, minimal boilerplate. |
| Styling | **NativeWind (Tailwind for RN)** + design tokens | Same utility classes on web (Tailwind) and mobile. |
| Payments | **RevenueCat** | Wraps App Store + Play Store subscriptions in one SDK; handles receipts, trials, tier entitlements. |
| Push notifications | **Expo Notifications** | Reminders, buddy nudges, challenge alerts. |
| Analytics / Crash | **PostHog + Sentry** | Funnel + churn analytics; crash reporting. |
| Monorepo | **Turborepo + pnpm** | apps/mobile, apps/web, packages/shared. |

### Critical platform facts (read before starting)
1. **iOS from Windows:** You develop on your PC, test on Android emulator + Expo Go on a real iPhone. Final iOS binaries are built by **EAS Build** in the cloud and submitted with **EAS Submit**. You never need a Mac. You DO need an Apple Developer account ($99/yr) to publish.
2. **Apple rule:** If the app offers Google login, Apple **requires** you to also offer **Sign in with Apple**. Plan both from day one.
3. **Subscriptions:** In-app subscription payments MUST go through App Store / Play Store billing (RevenueCat handles this). Web checkout on the website can use a card gateway and unlock the same account.

---

## 3. ARCHITECTURE

### 3.1 High level

> **Superseded.** The box below reads SUPABASE. It is Neon Postgres, reached
> only through `apps/web` API routes. Auth, storage and the scheduled jobs are
> all our own code; there are no edge functions. Realtime was only ever for
> Buddy Sync, which was cut.

```
┌─────────────┐   ┌─────────────┐   ┌──────────────────┐
│  iOS app     │   │ Android app  │   │  Website + Admin  │
│  (Expo RN)   │   │ (Expo RN)    │   │  (Next.js)        │
└──────┬───────┘   └──────┬───────┘   └────────┬─────────┘
       │   shared packages: ui-tokens, types, api-client, logic
       └──────────────┬───────────────┬────────┘
                      ▼               ▼
              ┌──────────────────────────────┐
              │           SUPABASE            │
              │  Auth (Google/Apple/Email)    │
              │  Postgres + RLS               │
              │  Realtime (Buddy Sync)        │
              │  Storage (progress photos)    │
              │  Edge Functions (plan engine, │
              │   webhooks, share cards)      │
              └──────────────┬───────────────┘
                             ▼
        RevenueCat · PostHog · Sentry · Expo Push
```

### 3.2 Expandability rules (non-negotiable)
- **Feature-module structure**: every feature lives in its own folder with its own screens, store, api, tests. Deleting a folder removes the feature cleanly.
- **No feature imports another feature directly** — only via `packages/shared` contracts.
- New modules planned for later (store, live classes, AI coach, wearables) plug in as new folders + new DB tables. Zero rewrites.
- All tier-gating goes through ONE function: `hasEntitlement(user, feature)` — never hardcode "if gold" in screens.

### 3.3 Offline-first data flow
1. Every log write → local SQLite immediately (instant UI).
2. Background sync queue pushes to Supabase when online.
3. Conflict rule: last-write-wins per field, server timestamp authoritative.
4. Read: TanStack Query with local cache hydration → screens never show spinners for own data.

---

## 4. MONOREPO FOLDER STRUCTURE

> **Superseded.** Close in spirit, wrong in detail. There is no
> `packages/api-client` (the mobile client lives in `apps/mobile/src/lib/api`)
> and no `supabase/` directory (migrations are `packages/db/migrations`). There
> is a `packages/ui-tokens`, and `apps/mobile` uses `src/app` and
> `src/features`. `README.md` has the real tree.

```
fitness-app/
├── apps/
│   ├── mobile/                  # Expo app
│   │   ├── app/                 # expo-router screens
│   │   │   ├── (auth)/          # login, onboarding quiz
│   │   │   ├── (tabs)/          # home, train, food, progress, buddy
│   │   │   └── gym-mode/        # fullscreen workout
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── onboarding/
│   │   │   ├── training/        # plans, logger, gym mode, PRs
│   │   │   ├── nutrition/       # kcal tracker, food db, suggestions
│   │   │   ├── body/            # weight, photos, measurements
│   │   │   ├── buddy/           # Gym Buddy Sync
│   │   │   ├── engagement/      # streaks, badges, challenges, share cards
│   │   │   └── subscription/    # tiers, paywall, RevenueCat
│   │   └── lib/                 # sqlite, sync-queue, notifications
│   └── web/                     # Next.js
│       ├── app/(marketing)/     # landing, pricing
│       ├── app/(app)/           # web account, progress view
│       └── app/(admin)/         # coach dashboard
├── packages/
│   ├── shared/                  # types, zod schemas, entitlements, constants
│   ├── ui-tokens/               # colors, spacing, typography (one source of truth)
│   └── api-client/              # typed Supabase queries used by web + mobile
├── supabase/
│   ├── migrations/              # SQL, versioned
│   └── functions/               # edge functions: plan-engine, share-card, webhooks
├── CLAUDE.md                    # Claude Code project instructions (provided)
└── turbo.json
```

---

## 5. DESIGN SYSTEM — "IRON DARK"

> **Superseded in its specifics.** The intent survived; the values did not. Real
> tokens are `packages/ui-tokens` and the brief is
> `apps/mobile/DESIGN-BRIEF.md`: charcoal `#131416` rather than black, signal
> red as the one accent, Poppins for headings and Oswald for numerals rather
> than Bebas Neue and Inter, and six tabs (Home, Train, Food, Meals, Gyms,
> Progress) rather than five. The accessibility rules in 5.3 are still binding
> and are repeated in `CLAUDE.md` hard rule 6.

Black-gradient gym aesthetic, engineered so a 45-year-old can use it one-handed between sets.

### 5.1 Tokens
```
Background:   #000000 → #0B0B0B gradient
Surface:      #101010   Surface-raised: #161616
Border:       #2E2E2E
Text:         #F2F2F2   Text-dim: #A8A8A8
Accent:       ONE brand accent only (pick: electric lime #C8FF00
              or signal red #FF3B30) — used for CTAs, PRs, progress rings
Success #22C55E · Warning #F59E0B · Error #EF4444
Radius: 12   Spacing scale: 4/8/12/16/24/32
```

### 5.2 Typography
- Display: **Bebas Neue / Oswald** (headers, numbers, PR screens)
- Body: **Inter** — body text **minimum 16px**, never below.
- Numbers users care about (weight, kcal, timer) rendered HUGE: 32–64px.

### 5.3 Accessibility & 40+ friendly rules (hard requirements)
1. Touch targets ≥ **48×48dp**, primary buttons ≥ 56dp tall.
2. Contrast ratio ≥ 4.5:1 everywhere (test dim text on dark surfaces).
3. Every icon gets a **text label**. No mystery-icon navigation.
4. Max 2 primary actions per screen. One obvious "next step" always visible.
5. Bottom-tab navigation, 5 tabs max: **Home · Train · Food · Progress · Buddy**.
6. Font-size setting in-app (Normal / Large / Extra-Large) + respects OS text scaling.
7. Gym Mode: giant text, whole-screen tap zones, works with sweaty thumbs.
8. Onboarding = one question per screen, big tappable option cards, no typing where a tap works.
9. Plain language: "Food" not "Nutrition Hub", "Buddy" not "Social Graph".
10. Haptic + visual confirmation on every log action.

### 5.4 Signature UI moments (the "unique" layer)
- **PR celebration**: full-screen takeover, accent flash, haptic burst, auto share-card.
- **Progress rings** on Home: kcal, protein, workout streak — one glance status.
- **Trend line, not scale number**: weight screen leads with 7-day trend arrow.
- **Plate calculator** visualizes actual plates on a barbell graphic.

---

## 6. FEATURE SPECS BY PHASE

### PHASE 1 — MVP (target: 8–10 weeks of focused building)
| Module | Scope |
|---|---|
| Auth | Google login, Apple login, email fallback (Supabase Auth). Profile creation. |
| Onboarding | Goal quiz → assigns plan template + kcal/macro targets. |
| Training | Plan viewer, workout logger (sets/reps/weight/RPE), rest timer, exercise library w/ video, Gym Mode, PR detection. |
| Body | Weight log + 7-day trend, measurements, progress photos (private bucket). |
| Nutrition | Kcal/macro targets, food search + barcode scan, custom foods, regional food seed database, water tracker. |
| Subscription | RevenueCat, paywall, tier entitlements, 7-day Gold trial. |
| Engagement | Streaks, PR share cards, push reminders. |

### PHASE 2 — v1.1 (weeks 11–16)
- **Gym Buddy Sync** (full spec below)
- Food suggestions engine (remaining-macros matching), meal plans + grocery list
- Challenges + badges, weekly check-in flow
- Coach admin dashboard v1 (members, plan publishing, revenue)

### PHASE 3 — v2 (growth)
- AI form check, voice logging, photo-to-kcal
- Wearable sync (Apple Health / Google Fit)
- Strength standards ranking, Year-in-review Wrapped
- In-app store, live classes, multi-coach marketplace

### 6.1 GYM BUDDY SYNC — full spec

> **CUT. Do not rebuild this.** It was built, then deleted end to end on
> 2026-07-17/18: no buddy tab, no `buddies` or `buddy_events` tables, no
> presence, no nudges. What survived is referrals, as Settings → "Invite
> friends" and the `/invite` screen. The public leaderboard, trials and coach
> challenge moved into non-buddy modules. The spec below is kept only so the
> decision is legible.

**Goal:** two or more friends train together even when apart; social pressure = retention.

Flows:
1. **Pair up**: invite via link/QR → buddy request → accept. Max 5 buddies (keeps it intimate, not a feed).
2. **Shared plan**: buddies can follow the same program; app shows "Day 3 — you and Suraj both have PUSH today".
3. **Live presence**: when a buddy starts a workout, others see "🔴 training now" (Supabase Realtime).
4. **Nudges**: buddy skipped a scheduled day → one-tap nudge push ("Don't let the streak die"). Rate-limited to 1/day.
5. **Buddy card**: this week's sessions, streak, last PR for each buddy.
6. **Duo challenges**: 2-person weekly volume/session goals with a shared progress bar.

Data: `buddies (user_a, user_b, status)`, `buddy_events (type, actor, target, payload, created_at)`. Privacy: buddies see sessions/streaks/PRs only — never weight, photos, or kcal unless explicitly shared.

---

## 7. DATABASE SCHEMA (CORE)

> **Superseded.** The real schema is `packages/db/src/schema.ts`, and it is
> many times this size. The sketch below is the shape we set out to build.
> `buddies` and `buddy_events` do not exist: Buddy Sync was cut. And see the
> RLS line at the end of the block, which is wrong, next paragraph.

```sql
profiles        (id, display_name, dob, sex, height_cm, unit_pref,
                 tier, goal_type, activity_level, font_scale)
plans           (id, name, tier_required, goal_type, weeks, is_branded)
plan_workouts   (id, plan_id, week, day, name)
plan_exercises  (id, plan_workout_id, exercise_id, sets, rep_range, rest_sec)
exercises       (id, name, muscle_group, video_url, cues, substitutes)
workout_logs    (id, user_id, date, plan_workout_id, duration, synced)
set_logs        (id, workout_log_id, exercise_id, set_no, weight, reps, rpe, is_pr)
weight_logs     (id, user_id, date, kg)
measurements    (id, user_id, date, waist, chest, arm, hip, bodyfat_est)
photos          (id, user_id, date, storage_path)          -- private bucket
foods           (id, name, brand, region, kcal, protein, carb, fat, barcode)
food_logs       (id, user_id, date, meal, food_id, qty, grams)
targets         (id, user_id, kcal, protein, carb, fat, water_ml, active_from)
buddies         (id, user_a, user_b, status, created_at)
buddy_events    (id, type, actor_id, target_id, payload, created_at)
streaks         (user_id, current, best, last_workout_date)
subscriptions   (user_id, rc_customer_id, tier, expires_at)  -- mirror of RevenueCat
```
~~**Every table: RLS ON. Default policy = owner-only. Buddy tables get explicit shared-read policies.**~~

**NOT TRUE, and do not act on it.** This database has no row-level security.
It went away with Supabase: Neon is reached through one connection string whose
role owns the tables, so a policy would be bypassed by the very role running
every query. Owner-only is still the default; it is enforced one layer up, in
the API. The rule that replaced this one is hard rule 3 in `CLAUDE.md`.

---

## 8. SECURITY & SAFETY CHECKLIST

Status as of 2026-07-26, against the code.

- [x] ~~Supabase **Row Level Security on every table**~~ → **replaced.** Access
  control is API-layer only: every route guards through `@/lib/authz`, scopes
  by account or owning role, fails closed, and audits mutations. Nothing but
  `apps/web` may touch the database. See `CLAUDE.md` hard rule 3.
- [x] Progress photos and payment receipts are Cloudinary `authenticated`
  assets and every read mints a signed URL. Caveat: on the free tier those
  signed URLs never expire, so a captured one works forever
  (`docs/DEPLOY.md` §5.2 is the open item).
- [x] Tokens in the OS keychain, never plain AsyncStorage. On device the
  persisted store is AES-256 MMKV with the key in SecureStore, and it fails
  closed to memory if the keychain is unavailable.
- [x] All tier checks re-validated server-side. `effectiveTier()` runs at the
  auth choke point and a client can never grant itself a paid tier.
- [x] RevenueCat webhooks verify the signature and reject on 401; subscription
  state is server truth.
- [x] Account deletion + data export in Settings. See
  `docs/ACCOUNT-DELETION-PRIVACY.md`.
- [ ] Health data disclosures in App Store / Play privacy forms. Privacy policy
  page is live at `/privacy`; the store forms are still the owner's to fill in.
- [x] Rate limiting on the auth endpoints, shared across instances once the
  Redis variables are set. Nudges and invites went with Buddy Sync.
- [x] No secrets in the repo: `.env` + EAS secrets, and `.env.example` carries
  names only. Sentry was never added, so nothing scrubs crash PII, because
  there are no crash reports at all.
- [x] Zod validation on every API boundary, schemas in `packages/shared`.

---

## 9. PERFORMANCE BUDGETS

- Cold start → Home: **< 2s** mid-range Android.
- Any log action (set, weight, food): UI confirms **< 100ms** (local write first).
- 60fps lists: FlashList for all feeds/history.
- Images: compressed on-device before upload; thumbnails for grids.
- App size: keep under 60MB; exercise videos streamed, never bundled.
- Works fully offline in the gym; sync is invisible.

---

## 10. CLAUDE CODE — FULL SETUP

### 10.1 One-time install (Windows PC)
```bash
# prerequisites
winget install OpenJS.NodeJS.LTS Git.Git
npm i -g pnpm eas-cli
npm i -g @anthropic-ai/claude-code

# create the project
mkdir fitness-app && cd fitness-app
claude
```

### 10.2 Bootstrap prompts (run inside Claude Code, in order)

> **Do not run these. The repo already exists.** They describe scaffolding a
> greenfield project onto Supabase, NativeWind and RLS, all three of which were
> reversed. Following prompt 1 or 2 today would tear the app up. To bring up a
> new environment against the code that exists, use `docs/DEPLOY.md` §0.
1. "Read CLAUDE.md and PROJECT_PLAN.md. Scaffold the Turborepo exactly as the folder structure in section 4: Expo app with expo-router + NativeWind + TypeScript in apps/mobile, Next.js 14 in apps/web, packages/shared + ui-tokens + api-client. Commit when it builds."
2. "Set up Supabase: create migrations for the schema in section 7 with RLS owner-only policies on every table. Add the typed api-client package."
3. "Implement the design tokens from section 5 in packages/ui-tokens and build base components: Button (56dp), Card, Screen, StatRing, BigNumber, TabBar. Follow every accessibility rule in 5.3."
4. "Build the auth feature: Supabase Google + Apple + email login, expo-router (auth) group, profile creation."
5. Then one feature module at a time, in Phase-1 order.

### 10.3 Working rhythm (do this every session)
- One feature module per session. Start: "Read CLAUDE.md. Today we build `features/nutrition` per PROJECT_PLAN section 6."
- End every session: "Run typecheck + tests + lint, fix failures, update CLAUDE.md progress log, commit."
- Ask Claude Code to write tests for logic (PR detection, trend smoothing, macro math, sync queue) — these are the bug-prone parts.

### 10.4 Build & ship from Windows
```bash
# dev
pnpm dev                     # web + API on http://localhost:3055
cd apps/mobile && npx expo start   # scan QR w/ Expo Go on your phone

# release
eas build --platform android --profile production
eas build --platform ios --profile production      # cloud macOS build
eas submit -p ios && eas submit -p android
```

---

## 11. WHAT TO DECIDE BEFORE FIRST COMMIT

All settled long ago. Kept for the record, with what was chosen.

1. ~~Brand name + one accent color (lime or red).~~ The GM Method, signal red.
2. ~~Tier prices for all 4 tiers.~~ Starter, silver, gold, elite, priced per
   region (NPR and USD) from Admin → Pricing.
3. ~~Supabase account~~ → a Neon project. Apple Developer, Google Play and
   RevenueCat accounts are still the owner's to open; that is what blocks store
   billing today (`docs/DEPLOY.md` §2.1).
4. ~~Who films exercise videos, and the first 3 plan templates.~~ 873 exercises
   are seeded from free-exercise-db, and the three launch plans ship as
   `seed:training-catalog`. Coach video upload is built and waits on content.
