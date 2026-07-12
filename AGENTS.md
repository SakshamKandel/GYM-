# AGENTS.md — Fitness Coaching App

You are building a coach-branded fitness app: iOS + Android (Expo React Native) + website/admin (Next.js), backend on Neon Postgres. Full spec lives in PROJECT_PLAN.md — read it before any architectural decision.

## Stack
- Turborepo + pnpm. apps/mobile (Expo SDK 57, expo-router, TypeScript strict, StyleSheet + tokens), apps/web (Next.js App Router), packages/shared (types + zod), packages/ui-tokens, packages/db (Drizzle + Neon).
- **Neon Postgres** (decided 2026-07-03, replaces Supabase): schema in packages/db via Drizzle, mobile talks to it only through the API layer (apps/web routes), never directly. Auth provider TBD. RevenueCat for subscriptions. Zustand for state. expo-sqlite offline-first with a sync queue.
- Styling deviation (decided 2026-07-03): plain StyleSheet + @gym/ui-tokens instead of NativeWind — NativeWind v4 pins Tailwind v3 and has a history of breaking on SDK upgrades; v5 is pre-release. Zero-dependency tokens are upgrade-proof and work identically on web.

## Hard rules
1. **TypeScript strict. No `any`.** Shared types live in packages/shared only.
2. **Feature modules are isolated.** features/X never imports from features/Y — only from packages/* and lib/*.
3. **Every new table ships with RLS policies in the same migration.** Owner-only by default.
4. **Tier gating** only via `hasEntitlement(user, feature)` from packages/shared. Never hardcode tier names in screens.
5. **Offline-first**: log writes hit SQLite first, sync queue second. UI must confirm in <100ms.
6. **Accessibility is not optional**: touch targets ≥48dp, body text ≥16px, contrast ≥4.5:1, labels on all icons, max 2 primary actions per screen. Respect the user's font-scale setting.
7. Design tokens from packages/ui-tokens only. No inline hex colors in screens.
8. Zod-validate every payload crossing the network boundary.
9. Secrets in .env / EAS secrets. Never commit keys.
10. Write tests for: PR detection, weight trend smoothing, macro math, sync-queue conflict handling, entitlement checks.

## Commands
- `pnpm dev` — web · `npx expo start` (in apps/mobile) — mobile
- `pnpm typecheck && pnpm lint && pnpm test` — run before every commit
- `pnpm supabase:migrate` — apply migrations locally

## Conventions
- Commits: conventional (feat:, fix:, chore:). One feature module per branch.
- Screens = thin; logic in feature `logic.ts` (testable, pure where possible).
- Naming: plain language user-facing ("Food", "Train", "Buddy").

## Progress log (update at end of each session)
- [x] Scaffold monorepo (2026-07-03)
- [x] Neon Postgres schema via Drizzle in packages/db (replaces Supabase; RLS N/A — access goes through the API layer)
- [x] ui-tokens + base components (charcoal/red reference design, Poppins+Oswald, motion vocabulary in components/ui/motion.ts)
- [~] Auth: email/password vs Neon via apps/web API + optional sign-in on mobile (Google/Apple pending OAuth credentials)
- [x] Onboarding quiz + targets (11-step wizard, computeTargets)
- [x] Training: plans, logger, gym mode, rest timer, plate calculator, true-3D Z-Anatomy selector with MuscleMapJS/SVG fallback, PR detection (unit-tested)
- [x] True-3D anatomy (2026-07-11): shared offline Three.js WebView/iframe viewer; clean Z-Anatomy outer body, neutral pelvis closure, 17 red/orange heat-map highlights, tap/orbit/zoom/front-back controls, SVG runtime fallback, and CC BY-SA attribution
- [x] Body: weight/trend (EWMA smoothing), measurements (photos pending)
- [x] Nutrition: kcal tracker, Open Food Facts + USDA search, barcode scan, water, custom foods
- [~] Subscription: GM Method tier catalog + paywall + hasEntitlement gating (RevenueCat pending store accounts)
- [~] Engagement: streaks + PR moment done; share cards + push pending
- [ ] Buddy Sync (Phase 2)
- [ ] Admin dashboard (Phase 2)
- [x] Startup UX: branded loading state replaces blank font, profile, and security hydration frames (2026-07-10)
- [ ] Sync queue: device SQLite ↔ Neon via API (architecture ready — repo layer + accounts exist)
- [x] 2026-07-12 scale-up (docs/SCALE-UP-PLAN.md W1-W5): buddy-session join + participant-visibility + referral-discount bugs fixed, onboarding "Stay on track" permission step (no-prompt notification/step-permission split); self-serve coach enrollment (coach_applications) + admin verify/reject + coach seniority tiers (silver/gold/elite, tier-request flow); promo codes (auto per verified coach, 30% off/30% commission + admin house codes) + coach wallet ledger + regional pricing catalog (NP NPR / INTL USD, admin pricing editor); manual Nepal payment requests (eSewa/Khalti receipt upload → admin approve/reject → dated tier grant); coach-assigned workouts + diet plans for silver+/gold+ clients; admin support inbox (threaded, unread-driven); friend-to-friend DMs on buddy links; image uploads (avatars, receipts, progress photos) via Cloudinary signed/authenticated delivery. Full spec + remaining deferred items: docs/SCALE-UP-PLAN.md.
