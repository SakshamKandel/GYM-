# GYM Tracker — Production Deploy Runbook

Verified 2026-07-03: `next build` (web) exit 0 · `expo export` (android bundle) exit 0 ·
`tsc --noEmit` clean in apps/web, apps/mobile, packages/db · security sweep: no hard blockers.

---

## 0. Schema migration (dated subscriptions + video views)

Three additive, nullable/defaulted columns ship with the dated-subscriptions /
video-views work. `pnpm --filter @gym/db db:push` (drizzle-kit push) generates
and applies them with no prompts and no data loss — every existing row keeps
working (null dates = no expiry, views default 0). The exact DDL push emits:

```sql
ALTER TABLE "accounts"     ADD COLUMN "tier_started_at" timestamp with time zone;
ALTER TABLE "accounts"     ADD COLUMN "tier_expires_at" timestamp with time zone;
ALTER TABLE "plan_videos"  ADD COLUMN "views" integer DEFAULT 0 NOT NULL;
```

Semantics: `tier_expires_at` NULL = permanent/free (never lapses). A past
`tier_expires_at` lapses the paid tier immediately — `effectiveTier()` collapses
it to `starter` at the auth choke point (`userForToken` / `/api/me` / login), so
NO cron is required and the stored `tier` is preserved for history/reactivation.

Optional env: `COACH_GREECE_EMAIL` — the coach account that Elite members are
auto-assigned to. If unset, the auto-coach resolves to the oldest
`admins.role='coach'` account (Greece, seeded first). See §3.

## 1. Web + API → Vercel

Project root: `apps/web` (Next 15). DB schema is already pushed to Neon; staff accounts seeded.

**Environment variables (Vercel → Settings → Environment Variables):**

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon connection string |
| `CLOUDINARY_CLOUD_NAME` | ✅ for video | `qbl5lkap` |
| `CLOUDINARY_API_KEY` | ✅ for video | |
| `CLOUDINARY_API_SECRET` | ✅ for video | **Rotate it first** — it was shared in chat |
| `CLOUDINARY_URL_SIGNING_KEY` | ✅ **load-bearing since 2026-07-12** | Signs `authenticated`-delivery images. Payment receipts (`GET /api/admin/payment-requests`) and progress photos (`/api/me/photos`, `/api/coach/clients/[userId]/photos`) are stored as Cloudinary `authenticated` assets; each GET mints a signed URL per row via `signedImageUrl()`. **Missing this var → those endpoints 503 `{error:'image_not_configured'}`**, not a silent image failure — set it before the coach/payment/progress-photo surfaces go live. |
| `GROQ_API_KEY` | ✅ for AI coach/tips | degrades quietly if missing |
| `FIREBASE_SERVICE_ACCOUNT_B64` | for push | buddy/coach push notifications; also drives `support_reply`, `buddy_message`, `coach_plan`, `application_decided`, `payment_decided`, `tier_request_decided` pushes (2026-07-12) |
| `GOOGLE_CLIENT_ID`(`S`) | for Google sign-in | |
| `VIDEO_PROVIDER` | optional | auto-selects `cloudinary` when CLOUDINARY_* present |

Then deploy. Post-deploy smoke test (2 min):
1. `https://<domain>/admin` → log in (super admin) → Overview shows real counts.
2. Members → open a member → change tier → Audit log shows the entry.
3. `https://<domain>/coach` → log in as Greece → inbox loads.
4. Admin → Content → upload a small video → appears with tier chip → plays in the app for that tier.

## 2. Mobile → EAS build

- `apps/mobile/eas.json` exists — **replace `https://YOUR-VERCEL-DEPLOYMENT.vercel.app` with the real deployed URL** in the `preview` and `production` profiles (this sets `EXPO_PUBLIC_API_URL`; without it a store build points at localhost).
- `google-services.json` is gitignored but referenced by app.json. Either keep the local file when building, or upload it to EAS: `eas env:create --scope project --name GOOGLE_SERVICES_JSON --type file`.
- Camera + photo-library permission strings are configured via the `expo-camera` / `expo-image-picker` plugins in app.json (required by App Store / Play review).
- Build: `cd apps/mobile && eas build --profile production --platform android`.
- For quick device testing without a build: Expo Go + `EXPO_PUBLIC_API_URL=http://<PC-LAN-IP>:3000` (or the Vercel URL).

## 3. Staff access

| Account | Role | Console |
|---|---|---|
| `admin@gym.com` | super_admin | `/admin` (web) or in-app Staff hub |
| `greecemaharjan@gmail.com` | coach | `/coach` (web) or in-app Staff hub |

**Change both passwords before launch** (current ones were shared in chat). New staff: Admin → Staff → grant role (no SQL needed).

**Elite auto-assign (2026-07):** whenever a member's EFFECTIVE tier becomes
`elite` (admin override via `/api/admin/subscriptions`, or a coach via
`/api/coach/subscriptions`), an ACTIVE `coach_assignments` row to the auto-coach
is ensured (idempotent — an `ended` row is reactivated, never a crash). When the
effective tier drops below elite (downgrade or expiry-driven override), that
auto-created row is set `ended` — a MANUAL assignment to a different coach is
left untouched. The auto-coach is resolved by `COACH_GREECE_EMAIL` (if it maps
to a `role='coach'` account) else the oldest `role='coach'` account. Coaches may
set/extend subscriptions for their OWN active clients only via
`/api/coach/subscriptions` (gated by `content`-level `coach.user.read` +
`requireCoachOwnsUser`); admins keep the broader `subscription.override` path.

**Role hierarchy (2026-07):** `super_admin` → `main_admin` → sub-roles (`member_admin`, `nutrition_admin`, `content_admin`, `support_admin`, `coach`). `main_admin` holds every permission but may only manage (grant/revoke/suspend) sub-role holders; only a `super_admin` can create or remove `main_admin`/`super_admin` rows, and nobody can change their own row. `admins.role` is a plain text column (the enum is TypeScript-only), so adding `main_admin` required **no SQL migration** — grant it from Admin → Staff. **Deploy order:** ship the updated mobile app before granting the first `main_admin` — installed builds older than 2026-07 don't know the role, so the holder would see no staff console and older Staff screens could show an incomplete roster.

## 4. Promo/wallet/payments/pricing economy (2026-07-12 scale-up)

- **Promo codes**: every coach approved via Admin → Applications gets one
  auto-generated code (`discountPct=30`, `commissionPct=30`); admins can also
  create house codes (any pct, no commission) from Admin → Promos. A code
  grants one `discount_grants` row per redeeming account — only one active
  grant per account, best discount wins.
- **Wallet ledger is the source of truth** — there is no materialized balance
  column. `GET /api/coach/wallet` (and `/api/admin/wallets` for staff) always
  computes `SUM(wallet_ledger.amountMinor)` grouped by currency at read time.
  Commission credits post automatically via `settlePromoOnPurchase()` on any
  paid grant (preview self-serve pick, approved payment request, or future
  RevenueCat purchase); manual `adjustment`/`payout` rows come from Admin →
  Wallets and are audited. Ledger entries are idempotent per source
  (`unique(sourceType, sourceId)`) — re-running an approval never double-pays.
- **Payment-request approval flow** (Nepal manual billing): member submits
  tier + months + eSewa/Khalti/bank receipt image from the paywall →
  `payment_requests` row (pending). Admin → Payments shows the receipt via a
  freshly signed Cloudinary URL (needs `CLOUDINARY_URL_SIGNING_KEY`, see §1) and
  approve/reject. Approve does two things in one action: dated
  `setAccountTier()` for the paid window, then the same commission hook as
  above if a promo grant was attached. Reject just records a note — no tier
  change, no ledger entry.
- **Pricing editor**: Admin → Pricing upserts `tier_prices` (region × tier,
  minor units + currency). The subscription catalog (`GET
  /api/subscription/catalog`) reads this table first and only falls back to
  the hardcoded `DEFAULT_TIER_PRICES` in `packages/shared/src/logic/pricing.ts`
  if a row is missing — editing pricing here is live immediately, no deploy
  needed.

## 5. Known post-launch follow-ups (from the security sweep — none are deploy blockers)

1. **Rate-limit auth endpoints** (`/api/staff/login` first) — 10 attempts / 15 min per IP, via Neon counter or Vercel WAF. Do soon after launch.
2. **Cloudinary free-tier signed URLs don't expire** — a captured playback URL works forever. Acceptable at launch (assets are `authenticated`; unsigned URLs 401). Fix later via Cloudinary token auth (paid) or periodic `api_secret` rotation (invalidates all old URLs).
3. **Mobile session token lives in AsyncStorage** — move the auth slice to `expo-secure-store` before onboarding staff on personal devices.
4. `/api/auth/login` lets a *suspended* user mint a session row (token is unusable — `userForToken` filters `status='active'` — so no bypass; just add the status check for a cleaner UX).
5. **Nightly off-provider DB backup** (`pg_dump` → R2) — the plan's Phase 0 item, still the highest-priority ops gap.
