# AGENTS.md — Fitness Coaching App

You are building a coach-branded fitness app: iOS + Android (Expo React Native) + website/admin/partner consoles + marketing site (Next.js), backend on Neon Postgres.

**Where the truth lives.** PROJECT_PLAN.md is the original 2026-07-03 plan and is kept for history only; large parts of it were superseded (Supabase, NativeWind, RLS, Buddy Sync). Do not make an architectural decision from it. Use, in this order: this file, `docs/DEPLOY.md` (bootstrap, environment, operations), `packages/db/src/schema.ts` (the database), `packages/shared` (domain logic and contracts), and the feature docs in `docs/`. CLAUDE.md carries the same rules and the fuller session-by-session progress log.

## Stack
- Turborepo + pnpm. apps/mobile (Expo SDK 57, expo-router, TypeScript strict, StyleSheet + tokens), apps/web (Next.js App Router), packages/shared (types + zod), packages/ui-tokens, packages/db (Drizzle + Neon).
- **Neon Postgres** (decided 2026-07-03, replaces Supabase): schema in packages/db via Drizzle, mobile talks to it only through the API layer (apps/web routes), never directly. Auth is ours, not a provider: email + password against Neon, plus Google and Apple ID-token verification server side, sessions as bearer tokens minted by apps/web. RevenueCat for store subscriptions. Zustand for state. expo-sqlite offline-first with a sync queue.
- Styling deviation (decided 2026-07-03): plain StyleSheet + @gym/ui-tokens instead of NativeWind — NativeWind v4 pins Tailwind v3 and has a history of breaking on SDK upgrades; v5 is pre-release. Zero-dependency tokens are upgrade-proof and work identically on web.

## Hard rules
1. **TypeScript strict. No `any`.** Shared types live in packages/shared only.
2. **Feature modules are isolated.** features/X never imports from features/Y — only from packages/* and lib/*.
3. **Every new table ships with its access rule in the API layer.** There is no row-level security in this database and there is not meant to be: Neon is reached through one connection string that owns the tables, so an RLS policy would be bypassed by the very role that runs every query. (The single `ENABLE ROW LEVEL SECURITY` in `migrations/legacy/0004_apple_auth.sql` is a deny-all on a pre-auth nonce table, and the comment there says the API role bypasses it.) So: nothing but `apps/web` routes may touch the database, every route guards through `@/lib/authz` and scopes its query by `accountId` (or the owning coach, partner or staff role), guards fail closed, and mutations call `logAudit`. Owner-only is still the default, it is just enforced one layer up.
4. **Tier gating** only via `hasEntitlement(user, feature)` from packages/shared. Never hardcode tier names in screens.
5. **Offline-first**: log writes hit SQLite first, sync queue second. UI must confirm in <100ms.
6. **Accessibility is not optional**: touch targets ≥48dp, body text ≥16px, contrast ≥4.5:1, labels on all icons, max 2 primary actions per screen. Respect the user's font-scale setting.
7. Design tokens from packages/ui-tokens only. No inline hex colors in screens.
8. Zod-validate every payload crossing the network boundary.
9. Secrets in .env / EAS secrets. Never commit keys.
10. Write tests for: PR detection, weight trend smoothing, macro math, sync-queue conflict handling, entitlement checks.

## Commands
- `pnpm dev` — web on **port 3055** · `npx expo start` (in apps/mobile) — mobile
- `pnpm typecheck && pnpm lint && pnpm test` — run before every commit

### Database
Full bootstrap chain (create → push → seed exercises → seed catalog → seed staff) is `docs/DEPLOY.md` §0. Short form:

| Command | Notes |
|---|---|
| `pnpm --filter @gym/db db:push` | Build/refresh the schema from `src/schema.ts`. Fine on your own database; **never unattended on a shared one** — it stops on an interactive prompt, and for a unique index on a populated table the prompt is "truncate the table?" |
| `pnpm --filter @gym/db check:constraints` | Read-only pre-flight. Reports the rows that would make a new unique index fail to create, and how to resolve each |
| `pnpm --filter @gym/db diff:schema` | Read-only. What `src/schema.ts` has that the live database does not, plus tables the database still has that the code dropped |
| `pnpm --filter @gym/db preview:normalize` | Read-only. What the normalisation pass would add, drop or re-point, checked against the live catalog |
| `pnpm --filter @gym/db db:generate` | Write the next numbered migration into `packages/db/migrations/` |
| `pnpm --filter @gym/db apply:migration migrations/0003_x.sql` | Apply one reviewed file in a single transaction; refuses any destructive statement, rolls back on the first error. **No `--` before the path** — pnpm 10 passes the separator through as an argument and the script then looks for a file called `--`. Path is relative to `packages/db` |

Do not replay `packages/db/migrations/` on a new database. The history starts from a baseline introspected from the live database and cannot recreate itself; `db:push` builds a fresh database instead. See `packages/db/migrations/meta/_README.md`.

## Conventions
- Commits: conventional (feat:, fix:, chore:). One feature module per branch.
- Screens = thin; logic in feature `logic.ts` (testable, pure where possible).
- Naming: plain language user-facing. The six tabs are Home, Train, Food, Meals, Gyms, Progress.

## What the product is now (read this before the log below)

Six member tabs: Home, Train, Food, Meals, Gyms, Progress. Beyond training,
nutrition and body tracking it also runs coach mentorship (discovery, requests,
assignments, chat, coach-assigned workouts and diet plans), a meal-delivery
vertical with its own isolated restaurant partner portal, a Nearby Gyms
directory with enquiries and day passes, a promo/wallet/payout economy with
regional pricing and a manual Nepal receipt rail, and a 14-page marketing site.
Three web consoles: `/admin`, `/coach`, `/partner`. Buddy Sync was cut, not
deferred.

## Progress log (update at end of each session)

CLAUDE.md holds the fuller log. The entries below are the ones written here;
where the two overlap, CLAUDE.md is the one to trust.

- [x] Scaffold monorepo (2026-07-03)
- [x] Neon Postgres schema via Drizzle in packages/db (replaces Supabase; RLS N/A — access goes through the API layer)
- [x] ui-tokens + base components (charcoal/red reference design, Poppins+Oswald, motion vocabulary in components/ui/motion.ts)
- [~] Auth: email/password vs Neon via apps/web API + optional sign-in on mobile (Google/Apple pending OAuth credentials)
- [x] Onboarding quiz + targets (12-step wizard incl. the 2026-07-12 "stay on track" permission step, computeTargets)
- [x] Training: plans, logger, gym mode, rest timer, plate calculator, true-3D Z-Anatomy selector with MuscleMapJS/SVG fallback, PR detection (unit-tested)
- [x] True-3D anatomy (2026-07-11): shared offline Three.js WebView/iframe viewer; clean Z-Anatomy outer body, neutral pelvis closure, 17 red/orange heat-map highlights, tap/orbit/zoom/front-back controls, SVG runtime fallback, and CC BY-SA attribution
- [x] Body: weight/trend (EWMA smoothing), measurements, progress photos (upload + compare slider on mobile, Cloudinary authenticated delivery, admin moderation queue)
- [x] Nutrition: kcal tracker, Open Food Facts + USDA search, barcode scan, water, custom foods
- [~] Subscription: GM Method tier catalog + paywall + hasEntitlement gating (RevenueCat pending store accounts)
- [~] Engagement: streaks + PR moment + push done (FCM via lib/notify + the in-app inbox); share cards still pending, and they are the only piece left here
- [x] Buddy Sync — CUT, not pending: deleted end-to-end on 2026-07-17/18. Referrals live on as Settings→"Invite friends" + /invite. Do not rebuild it.
- [x] Admin dashboard — shipped, not Phase 2. `/admin` (plus `/coach` and `/partner`) on the light-SaaS console shell, ~70 API route groups, RBAC + audit + re-auth.
- [x] Startup UX: branded loading state replaces blank font, profile, and security hydration frames (2026-07-10)
- [x] Sync queue: device SQLite ↔ Neon via the API. Workouts push and pull through `POST /api/sync/workouts` (keyset cursor); food logs, custom foods, weight, measurements, water and steps go through `POST /api/sync/member-data` (batched upserts, deterministic last-writer-wins, six `member_*` tables). Mobile side is `features/sync/*` over `lib/repo`.
- [x] Transactional email: Resend, wired behind ONE seam at `apps/web/src/lib/email/` (`index.ts` decides, `resend.ts` sends, plain fetch, no SDK). Set `RESEND_API_KEY` + `EMAIL_FROM`. Do NOT add a second provider outside that folder.
- [x] 2026-07-12 scale-up (docs/SCALE-UP-PLAN.md W1-W5): buddy-session join + participant-visibility + referral-discount bugs fixed, onboarding "Stay on track" permission step (no-prompt notification/step-permission split); self-serve coach enrollment (coach_applications) + admin verify/reject + coach seniority tiers (silver/gold/elite, tier-request flow); promo codes (auto per verified coach, 30% off/30% commission + admin house codes) + coach wallet ledger + regional pricing catalog (NP NPR / INTL USD, admin pricing editor); manual Nepal payment requests (eSewa/Khalti receipt upload → admin approve/reject → dated tier grant); coach-assigned workouts + diet plans for silver+/gold+ clients; admin support inbox (threaded, unread-driven); friend-to-friend DMs on buddy links; image uploads (avatars, receipts, progress photos) via Cloudinary signed/authenticated delivery. Full spec + remaining deferred items: docs/SCALE-UP-PLAN.md.
- [x] 2026-07-17 release hardening: effective admin/coach permissions now merge per-account allow/deny overrides across web, mobile, login, navigation, pages, and APIs with fail-closed behavior; manual payment calendar math, idempotent approval/refund, receipt/pending-request concurrency constraints, promo redemption accounting, and RevenueCat ordering/idempotency/HMAC verification hardened and regression-tested; production Neon schema pushed and existing billing data reconciled.
- [x] 2026-07-17 Google auth/release hardening: Vercel production audiences aligned with the APK web/Android OAuth clients; GitHub and EAS builds now embed the same public IDs; Android CI pins and verifies the release signing SHA-1/package before building; Google token audience/expiry/email verification regression-tested; successful main builds publish a latest GitHub Release instead of artifact-only output.
- [x] 2026-07-18 partner dashboard: `/partner` upgraded from a four-counter order queue to a responsive command center with partner-scoped order/customer/revenue analytics, seven-day sales chart, live fulfillment pipeline, active-subscription and menu-health signals, 30-day best sellers, COD exposure, quick actions, and the actionable fulfillment queue retained below the overview.
- [x] 2026-07-21 Expo web console hardening: arbitrary localhost Metro ports now receive CORS headers on API success and error responses; web-safe notification, workout-celebration, and streak fallbacks prevent native-only runtime warnings; nested pressables and navigation focus handoff were corrected; meal quotes now wait for a hydrated delivery address.
- [~] 2026-07-21 full feature/backend audit: 92 mobile screens, 26 feature modules, 67 web pages, and 218 API routes inventoried; 568 tests, all workspace typechecks, isolated Next production build, 123 signed-out API handlers, and 64 web pages verified. Closed since: migration drift (2026-07-25 baseline reset, see `packages/db/migrations/meta/_README.md`), seeded demo content (both demo seeds now refuse to run without `SEED_DEMO=yes` and never under `NODE_ENV=production`), body/nutrition sync (`POST /api/sync/member-data` covers weight, measurements, food logs, custom foods, water and steps), and placeholder member plans (`seed:training-catalog`). Still open: fabricated gym enrichment, preview-only billing, missing media/cron/store credentials, and unavailable disposable role-based test accounts.
- [x] 2026-07-21 food-ordering professional UI pass (member + partner + admin): mobile ordering journey rebuilt on the block language — meals tab red hero + monogram partner cards, partner-menu hero/cream subscribe block/macro-pill meal cards/red cart bar, checkout numbered steps with radio payment rows + Oswald total mirrored into the CTA, live order cards with semantic status colors (amber→blue→orange→red/green) + LiveDot pulse + macro roll-up + order numbers, celebratory confirmation hero. Partner console: live-pulse KPI/pipeline (StatTile `live` prop + `gt-live-dot` in globals.css), Today board kanban with status-color columns/card strips/lane money totals/GM-order numbers (new board.module.css), fulfillment queue + detail drawer (visual timeline) + menu cards (price pill, macro chips) polished; admin orders table gained order numbers + status dots. New tokens: info + successFaint/warningFaint/infoFaint/orangeFaint status washes (contrast-checked). No logic/API changes — typecheck, lint (0 errors), and 54/54 tests green.
