# FITNESS COACHING APP — FULL PROJECT SETUP & BUILD PLAN

Coach-branded fitness platform · iOS + Android + Web · Built with Claude Code

---

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

## 2. TECH STACK (DECIDED)

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
**Every table: RLS ON. Default policy = owner-only. Buddy tables get explicit shared-read policies.**

---

## 8. SECURITY & SAFETY CHECKLIST

- [ ] Supabase **Row Level Security on every table** — no exceptions.
- [ ] Progress photos in a **private storage bucket**, served via short-lived signed URLs.
- [ ] Tokens in **SecureStore/Keychain**, never AsyncStorage.
- [ ] All tier checks re-validated **server-side** (edge functions), client checks are UI-only.
- [ ] RevenueCat webhooks verify signatures; subscription state is server truth.
- [ ] Account deletion (App Store requirement) + data export in Settings.
- [ ] Health data disclosures in App Store / Play privacy forms; privacy policy page on website.
- [ ] Rate limiting on nudges, invites, and auth endpoints.
- [ ] No secrets in the repo — .env + EAS secrets. Sentry scrubs PII.
- [ ] Zod validation on every API boundary (shared schemas package).

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
pnpm dev                     # web
cd apps/mobile && npx expo start   # scan QR w/ Expo Go on your phone

# release
eas build --platform android --profile production
eas build --platform ios --profile production      # cloud macOS build
eas submit -p ios && eas submit -p android
```

---

## 11. WHAT TO DECIDE BEFORE FIRST COMMIT

1. Brand name + one accent color (lime or red).
2. Tier prices (monthly + annual) for all 4 tiers.
3. Supabase account + Apple Developer ($99/yr) + Google Play ($25 one-time) + RevenueCat (free tier fine).
4. Who films exercise videos, and the first 3 plan templates (Fat Loss / Muscle / Strength) — the app is a shell without the coach's actual programming.
