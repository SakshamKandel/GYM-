# CLAUDE.md — Fitness Coaching App

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
- [~] Auth: email/password vs Neon via apps/web API + optional sign-in on mobile; Google↔password account linking (password-proven, /api/auth/google + GoogleLinkPrompt); post-login/onboarding nav resets the whole stack via lib/nav resetStackTo (back can't reopen Welcome) (Google/Apple pending OAuth credentials)
- [x] Onboarding quiz + targets (11-step wizard, computeTargets)
- [x] Training: plans, logger, gym mode, rest timer, plate calculator, true-3D Z-Anatomy selector with MuscleMapJS/SVG fallback, PR detection (unit-tested)
- [x] True-3D anatomy (2026-07-11): shared offline Three.js WebView/iframe viewer; clean Z-Anatomy outer body, neutral pelvis closure, 17 red/orange heat-map highlights, tap/orbit/zoom/front-back controls, SVG runtime fallback, and CC BY-SA attribution
- [x] Body: weight/trend (EWMA smoothing), measurements (photos pending)
- [x] Nutrition: kcal tracker, Open Food Facts + USDA search, barcode scan, water, custom foods
- [~] Subscription: GM Method tier catalog + paywall + hasEntitlement gating (RevenueCat pending store accounts)
- [~] Engagement: streaks + PR moment done; share cards + push pending
- [ ] Buddy Sync (Phase 2)
- [ ] Admin dashboard (Phase 2)
- [ ] Sync queue: device SQLite ↔ Neon via API (architecture ready — repo layer + accounts exist)
- [x] Coach-Trainee Mentorship (2026-07-10): discovery hub (/coaches + /coaches/[id]), member requests + coach accept/decline (coach_requests table, one pending per member, capacity-gated), coach portfolio (coachProfiles + headline/specialties/certifications/achievements/years/capacity; edited in staff/coach/profile), coach-logged client milestones (coach_milestones → member Progress portfolio), server-side PII masking on ALL coach-member text (maskPii in @gym/shared, unit-tested), chat unlocked by active assignment OR elite, coach identity data-driven (no more hardcoded Greece), client emails stripped from coach console. Full spec: docs/mentorship-system.md. New tables land on next `pnpm db:push`.
- [x] 2026-07-10 hardening pass: fluid sliding-disc FloatingTabBar (squash-stretch, live-workout dot, reduce-motion); initial pseudo-3D anatomy explorer (superseded by the 2026-07-11 true-3D viewer above); muscle-map tables hoisted to lib/muscleMap.ts; food quality (Nutri-Score/NOVA/fiber/sugar/sodium) from OFF+USDA end-to-end; BILLING_MODE=live gate + RevenueCat webhook (/api/subscription/revenuecat) — paid tiers can't be self-granted in live mode; tier gating unified on useEffectiveTier (local tier = signed-out preview only; trial no longer writes it); profile cloud-restore claim-lock; ~45 audited fixes (sheets/keyboard containment, touch targets, spacing rhythm, duplicate PR stamps, measurement units, silent failures, buddy double-taps, backend indexes/rate limits/enumeration oracle — indexes land on next `pnpm db:push`)
