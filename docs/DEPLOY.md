# GYM Tracker — Production Deploy Runbook

Section 0 bootstraps an empty database. Sections 1 to 5 cover the hosted web
API, the mobile build, staff access, the money surfaces, and what is still
open.

---

## 0. Bootstrap a fresh deployment

This is the whole chain, in order. Each step needs the one before it, and a
step skipped shows up later as an empty screen rather than an error.

### 0.1 Install, and point at a database

```bash
pnpm install                # repo root
cp .env.example .env        # then fill in DATABASE_URL
```

`DATABASE_URL` is a Neon connection string (Neon console → your project →
Connect). The repo-root `.env` is the file the database tooling reads:
`packages/db/drizzle.config.ts` and every seed load `../../.env`. The migration
scripts also pick up `apps/web/.env.local` if you keep your values there
instead.

### 0.2 Build the schema

```bash
pnpm --filter @gym/db db:push
```

`packages/db/src/schema.ts` is the source of truth, so an empty database comes
out matching exactly what the app expects. There is nothing to prompt about on
a new database because there is no data to reshape.

Do not try to replay `packages/db/migrations/`. That history starts from a
baseline introspected out of the live database and cannot recreate itself.
`packages/db/migrations/meta/_README.md` explains why, and `migrations/legacy/`
is kept for history only.

Then confirm it landed:

```bash
pnpm --filter @gym/db check:constraints
```

Read-only. It prints `PRE-FLIGHT CLEAN` when every partial-unique and
functional-unique index in the schema can exist.

### 0.3 Seed the exercise library

```bash
pnpm --filter @gym/db seed:exercises
```

873 exercises from `packages/db/src/seed/data/exercises.json`, the
free-exercise-db snapshot kept in the repo as an import fixture. The app ships
no exercise list of its own, so until this runs the training catalog is empty
and there is nothing for a member to log. Needs 0.2 first (it writes into the
`exercises` table) and nothing else.

Idempotent: keyed by id, so re-running refreshes names, muscles and images in
place. The ids are a contract. Plan videos and PR detection join on them, so
never regenerate or renumber them.

### 0.4 Seed the training catalog

```bash
pnpm --filter @gym/db seed:training-catalog
```

The three launch plans (STRENGTH BASE, MUSCLE BUILDER, LEAN MACHINE) with their
workouts and exercise slots. Needs 0.3 first: it checks every exercise id it
references up front and stops with the missing list rather than writing a
half-built plan. It never overwrites a plan an admin has since edited.

### 0.5 Create the first staff account

```bash
SEED_STAFF_EMAIL=you@example.com \
SEED_STAFF_PASSWORD='a long passphrase' \
  pnpm --filter @gym/db seed:staff
```

The one account that cannot be made from the console, because making staff
needs someone already signed in. It creates a single `super_admin`, and every
other role is granted from Admin → Staff afterwards.

Both variables are required and neither has a default. The password must be at
least 12 characters. If that email already belongs to an account that is not
staff, the script stops rather than quietly handing a member full access; add
`SEED_STAFF_PROMOTE_EXISTING=yes` if the account really is yours. It never
rewrites a password that already exists, so re-running it is safe.

Sign in at `https://<domain>/admin/login`.

### 0.6 Set prices

Admin → Pricing, once the site is up. The public pricing page shows a region
only when all four tiers (starter, silver, gold, elite) have an active price in
one currency for that region, so a half-filled region stays hidden rather than
showing gaps. The in-app catalog falls back to the compiled defaults in
`packages/shared/src/logic/pricing.ts`; the marketing site deliberately does
not.

### 0.7 Demo content (optional, never in production)

```bash
SEED_DEMO=yes pnpm --filter @gym/db seed:demo-coach   # one verified demo coach
SEED_DEMO=yes pnpm --filter @gym/db seed:live-demo    # demo meal partner + menu
```

Both are member-visible, both refuse to run without `SEED_DEMO=yes`, and
neither runs under `NODE_ENV=production`. Skip them for a real launch.

## 0.8 Changing the schema after launch

`drizzle-kit push` is the right tool for your own database and the wrong one
for a shared database. It stops on an interactive prompt, and for a unique
index on a table that already holds rows the prompt it offers is "truncate the
table?", so it can never be run unattended. Five commands cover that path
instead, and the first three only read.

| Command | What it does |
|---|---|
| `pnpm --filter @gym/db diff:schema` | Lists what `src/schema.ts` has that the live database does not: missing tables, columns, indexes and uniques, plus tables the database still carries that the code no longer declares. Executes nothing |
| `pnpm --filter @gym/db check:constraints` | Pre-flight. Finds the rows that would make a new unique index fail to create (one member holding two pending coach requests, one account with two default addresses, one email on two legacy profiles) and says how to resolve each. Executes nothing |
| `pnpm --filter @gym/db preview:normalize` | Names every object the normalisation pass adds, drops or re-points, and says whether it already exists in the live database. Reads catalog metadata only |
| `pnpm --filter @gym/db db:generate` | Writes the next numbered `.sql` file into `packages/db/migrations/`. Read it before you run it |
| `pnpm --filter @gym/db apply:migration migrations/0003_your_change.sql` | Applies one reviewed file inside a single transaction. It refuses the whole run if the file contains `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `DROP DATABASE`, `TRUNCATE` or `DELETE FROM`, and rolls back on the first error, so a failure halfway leaves the database exactly as it started |

**Do not put `--` before the file name.** pnpm 10 does not strip the separator,
it hands it to the script as an ordinary argument, and the script then tries to
open a file called `--`. The path is relative to `packages/db`.

## 0.9 How dated tiers behave

`accounts.tier_expires_at` NULL means permanent or free, and never lapses. A
past `tier_expires_at` lapses the paid tier immediately: `effectiveTier()`
collapses it to `starter` at the auth choke point (`userForToken`, `/api/me`,
login), so no cron is required and the stored `tier` is kept for history and
reactivation.

## 1. Web + API → Vercel

Vercel root directory: the repo root. The repo-root `vercel.json` drives the
build (`turbo run build --filter=web`, output `apps/web/.next`) and registers
the cron entry, so pointing the project at `apps/web` instead breaks both.
Next 15, Node 22.

**Environment variables (Vercel → Settings → Environment Variables):**

Every row says what stops working while the variable is missing. The same list,
with the same wording and no values, lives in `.env.example` at the repo root —
copy that file when setting up a new environment, and keep the two in step.

| Var | Required | What breaks while it is missing |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon connection string. Nothing runs: every API route fails |
| `NEXT_PUBLIC_SITE_URL` | ✅ | Public origin of the website. Canonical links, `sitemap.xml` and `robots.txt` fall back to the old preview domain and point search engines there |
| `EXPO_PUBLIC_API_URL` | ✅ for the app | API base URL the mobile app calls. Unset → the app talks to `http://localhost:3000`, so a store build reaches nothing. Set per EAS profile (`apps/mobile/eas.json`, §2) |
| `RESEND_API_KEY` | ✅ for password reset | Resend API key ([resend.com](https://resend.com) → API Keys). Unset → `POST /api/auth/forgot-password` sends nothing, mints nothing and reports `not_configured`; the app then tells members reset-by-email is unavailable and passwords can only be reset by an admin (Members → credentials) |
| `EMAIL_FROM` | ✅ for password reset | Verified sender, e.g. `The GM Method <no-reply@yourdomain.com>`. The domain must be verified in Resend or it refuses the message. Unset → exactly as above. **Both email vars are required; either one missing means no email is ever sent** |
| `FIREBASE_SERVICE_ACCOUNT_B64` | ✅ for push | Base64 of the Firebase service-account JSON. Unset → no push is ever delivered. Inbox rows are still written, so reminders, coach replies, order updates and broadcasts only appear once the member opens the app |
| `CLOUDINARY_CLOUD_NAME` | ✅ for photos + video | `qbl5lkap`. The three `CLOUDINARY_*` below are needed together; any missing → avatars, receipts and progress photos cannot be uploaded at all, and video too unless `VIDEO_PROVIDER=cf_stream` is set up instead |
| `CLOUDINARY_API_KEY` | ✅ for photos + video | Cloudinary console → Settings → Access Keys |
| `CLOUDINARY_API_SECRET` | ✅ for photos + video | Signs uploads. **Rotate it first** — it was shared in chat |
| `CLOUDINARY_URL_SIGNING_KEY` | ✅ **load-bearing since 2026-07-12** | Signs `authenticated`-delivery images. Payment receipts (`GET /api/admin/payment-requests`) and progress photos (`/api/me/photos`, `/api/coach/clients/[userId]/photos`) are stored as Cloudinary `authenticated` assets; each GET mints a signed URL per row via `signedImageUrl()`. **Missing → those reads 503 `{error:'image_not_configured'}`** even though uploads still succeed, so an admin cannot see the receipt they are approving money against. Since 2026-07-25 `isImageConfigured()` counts this key, so the admin Configuration card and the startup log report photos as turned off instead of claiming they work |
| `VIDEO_PROVIDER` | optional | `cloudinary` (auto-selected when `CLOUDINARY_*` present) or `cf_stream` |
| `CF_STREAM_ACCOUNT_ID` / `_API_TOKEN` / `_KEY_ID` / `_JWK` | optional | Only for `VIDEO_PROVIDER=cf_stream`; all four required together. Any missing → coaches cannot publish or play plan videos |
| `BILLING_MODE` | ✅ to sell plans | `disabled` (default, no paid activation), `preview` (non-production only: tiers are a free selection), `live` (paid tiers only via the RevenueCat webhook). Unset → nobody can buy a plan. **`live` needs BOTH RevenueCat webhook variables below; with either one missing the server reports `disabled`** rather than pretending to sell |
| `REVENUECAT_WEBHOOK_AUTH` | ✅ with `BILLING_MODE=live` | Exact `Authorization` header value the store webhook must send. **Missing → billing falls back to `disabled`**, so purchases in the stores never grant a tier. It is not silent: the boot log names it (see the startup self-check below) |
| `REVENUECAT_WEBHOOK_SIGNATURE_SECRET` | ✅ with `BILLING_MODE=live` | RevenueCat → the webhook you created → **Authorization header is not enough**: copy the signing secret too. `POST /api/subscription/revenuecat` rejects with 401 every event it cannot verify, so this is as load-bearing as `REVENUECAT_WEBHOOK_AUTH`. **Missing → billing falls back to `disabled`** exactly as above, and the boot log names it. Both must be set together before `live` means anything |
| `CRON_SECRET` | ✅ for reminders | Shared secret Vercel Cron sends as `Authorization: Bearer <value>`. **Missing → every `/api/cron/*` route fails closed with 500** and no scheduled job runs |
| `NOTIFICATIONS_CRON_ENABLED` | ✅ for reminders | Master switch, must be exactly `true`. Anything else → the tick returns `{skipped:"disabled"}`, so renewal notices, payment reminders and come-back nudges are never sent |
| `GROQ_API_KEY` | ✅ for the AI coach tip | The only AI surface in the product. Unset → `/api/ai/tip` answers `not_configured` and both cards fall back to their quiet empty state. Nothing else breaks |
| `GOOGLE_CLIENT_ID`(`S`) | for Google sign-in | Accepted ID-token audiences; `…_IDS` takes a comma-separated web/iOS/Android list. Both unset → the server rejects every Google sign-in |
| `APPLE_CLIENT_ID`(`S`) | for Apple sign-in | Same pair for Apple (Services ID / bundle id). Both unset → Apple sign-in rejects every token |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `_IOS_` / `_ANDROID_` | for Google sign-in | Compiled into the app. Unset → the Google button stays hidden and only email sign-in is offered |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | ✅ to sell on iPhone | RevenueCat → Project settings → API keys → the **public** app-specific key for the iOS app. Compiled into the app, safe to ship (it can only read offerings and start a purchase the store itself confirms). Unset → the store purchase sheet and the Restore purchases row never appear on iOS, and the paywall keeps the receipt rail. See §2.1 |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | ✅ to sell on Android | Same, for the Google Play app. Unset → exactly as above on Android |
| `EXPO_PUBLIC_USDA_API_KEY` | optional | Second food source. Unset → food search still works through Open Food Facts, with fewer US branded results |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_URL` / `_TOKEN`) | recommended | Shared store for the limits on sign-in, registration, password reset and staff re-auth. Unset → those limits count per instance, so the real ceiling is `limit × warm instances`. That matters most for the sign-in lockout: 10 tries per 15 minutes at one account is only one budget for everybody once this is set. Either name pair works |
| `COACH_GREECE_EMAIL` | optional | Coach that Elite members are auto-assigned to (§3). Unset → the oldest coach account is used |
| `NOTIF_PREFS_ENFORCED` | optional | Per-account notification preferences and quiet hours, default on. Set to `false` ONLY to debug a preferences bug: every member then gets every push regardless of what they turned off |
| `PRICE_CHANGE_GUARD_ENABLED` | optional | Set to `true` to reject a meal order whose total moved since the cart was priced. Unset → the order goes through at the new price without asking |
| `PARTNER_LEDGER_ENABLED` | optional | Cutover marker for observability only; it must never gate money math. Unset → no effect on any balance |
| `SEED_DEMO` | never in production | Demo coach seed guard (`packages/db seed:demo-coach`). Must be exactly `yes` or the seed refuses to run, and it never runs under `NODE_ENV=production` |

**Startup self-check:** in production `apps/web/src/instrumentation.ts` logs one
`[startup]` line per missing capability (billing, images, video, cron secret,
cron switch, password-reset email) into the Vercel logs at boot. Billing gets
the sharpest wording: setting `BILLING_MODE=live` without both RevenueCat
webhook variables logs which one is missing and says plainly that nobody gets
the membership they paid for. Grep the first minute of a deploy's logs for
`[startup]` before announcing a launch. It names variables only, never values,
and never throws, so the marketing site and free tier stay up regardless.

The same checks render as a "Configuration" card on `/admin` for super and main
admins, server-rendered on the page itself. There is no API endpoint for it,
and adding one would only give the numbers a second place to drift.

**Cron schedule:** the repo-root `vercel.json` registers ONE entry,
`/api/cron/tick` (currently daily at 03:00 UTC — Hobby's limit). Every scan
(outbox retry, trial expiry, renewal nudge, cycle dunning, day-2 re-engage) runs
on EVERY tick; there is no wall-clock gate. Each scan is bounded, anti-joined
against the notifications outbox and dedupe-keyed, so a more frequent schedule
(e.g. hourly `0 * * * *` on Pro) only drains stragglers faster — it never
double-notifies a member.

Then deploy. Post-deploy smoke test (2 min):
1. `https://<domain>/admin` → log in (super admin) → Overview shows real counts.
2. Members → open a member → change tier → Audit log shows the entry.
3. `https://<domain>/coach` → log in as Greece → inbox loads.
4. Admin → Content → upload a small video → appears with tier chip → plays in the app for that tier.

## 2. Mobile → EAS build

- `apps/mobile/eas.json` carries `EXPO_PUBLIC_API_URL` per profile, and all three already point at a real host. **Check it before your first build for a new deployment** and replace the URL in `preview` and `production` with your own domain, otherwise the build talks to somebody else's API.
- The same file also carries the two `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` values. The RevenueCat public keys are not in it: set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` as EAS project variables, or add them to the profile `env` block, or the build ships without a purchase sheet (§2.1).
- `google-services.json` is gitignored but referenced by app.json. Either keep the local file when building, or upload it to EAS: `eas env:create --scope project --name GOOGLE_SERVICES_JSON --type file`.
- Camera + photo-library permission strings are configured via the `expo-camera` / `expo-image-picker` plugins in app.json (required by App Store / Play review).
- Build: `cd apps/mobile && eas build --profile production --platform android`.
- For quick device testing without a build: Expo Go + `EXPO_PUBLIC_API_URL=http://<PC-LAN-IP>:3055` (or the Vercel URL). **3055 is the port**, not 3000: `pnpm dev` runs the web app on 3055 (`next dev -p 3055`). The app's own built-in fallback is still `http://localhost:3000`, which is why leaving `EXPO_PUBLIC_API_URL` unset reaches nothing even with the dev server running.

## 2.1 In-app purchases (RevenueCat + the stores)

**Who does what.** The app takes the payment through the App Store or Google
Play. The store confirms it to RevenueCat. RevenueCat calls
`POST /api/subscription/revenuecat`, and that webhook is the only thing that
turns a membership on. The app never grants a tier, so a tampered client buys
nothing. After a payment goes through, the app re-reads the account for about
ten seconds and, if the confirmation has not arrived yet, says so plainly
instead of pretending the membership is live.

**The purchase button only exists when all of this is true**, and hides itself
otherwise (there is never a button that cannot finish):

1. the device is an iPhone or an Android phone (the web build never sells),
2. the build carries the RevenueCat public key for that platform (§1),
3. the RevenueCat SDK started for the signed-in account,
4. the server reports billing as `live`, which needs `BILLING_MODE=live`
   **and both** `REVENUECAT_WEBHOOK_AUTH` and
   `REVENUECAT_WEBHOOK_SIGNATURE_SECRET`, so a purchase can actually be
   honoured,
5. the store has at least one product on sale for that membership.

Point 4 is deliberately all-or-nothing. The webhook refuses any event it cannot
verify, so a deployment with the signature secret missing would take real money
and grant nothing. Rather than let that happen the server reports `disabled`,
the button never appears, and the boot log says which variable is missing.

Until then the paywall behaves exactly as it does today, and the manual receipt
rail (§4) keeps working either way, including alongside the stores.

**Naming contract.** The app matches what a store sells to what this product
sells by name, and refuses to guess. Set the dashboard up this way:

| In RevenueCat | Name it | Why |
|---|---|---|
| Entitlement | exactly `silver`, `gold`, `elite` | The webhook reads the entitlement id as the tier. A different spelling grants nothing |
| Offering | one per tier, named after the tier (`gold`) | How the app knows which card a package belongs to |
| Package | one per length (monthly, yearly, …) | Becomes the choices in the purchase sheet |
| Product | e.g. `gm_gold_monthly` | Fallback match when an offering is not named after a tier |

An identifier that names two tiers at once (`silver_to_gold`) or none is left
unmapped and never offered. Prices always come from the store itself, in the
store's own currency and formatting, because that is the amount the member is
charged.

**Only the owner can do these, and none of them can be done from this repo:**

1. **Apple**: an Apple Developer Program membership, the Paid Applications
   agreement signed in App Store Connect (purchases fail until it is), an app
   record for `com.gmmethod.gymtracker`, and one auto-renewing subscription
   product per tier and length.
2. **Google**: a Play Console developer account, an app record for
   `com.gmmethod.gymtracker`, and the matching subscription products. Play only
   returns products once a build with the billing library has been uploaded to a
   testing track at least once.
3. **RevenueCat**: an account, a project, one app per platform, the store
   credentials it needs (App Store Connect API key / Play service account), the
   entitlements and offerings above, the public API keys for §1, and a webhook
   pointing at `https://<domain>/api/subscription/revenuecat` with the
   `Authorization` header value set to `REVENUECAT_WEBHOOK_AUTH`. Copy that
   webhook's signing secret into `REVENUECAT_WEBHOOK_SIGNATURE_SECRET` at the
   same time: the route verifies the signature on every event and 401s without
   it, so the two values are one step, not two.
4. **A native build**: `pnpm install` first (the dependency is declared in
   `apps/mobile/package.json` but not installed), then
   `eas build --profile production`. Purchases cannot work in Expo Go: it has no
   billing code. The library needs **no** Expo config plugin entry in
   `app.json`; autolinking picks it up during prebuild.
5. **A sandbox test before launch**: a StoreKit sandbox account on iOS and a
   licence tester on Android, buy each tier once, confirm the membership turns
   on by itself within a minute (Admin → Members shows the tier and its end
   date), then confirm **Restore purchases** brings it back on a fresh install.

Turning `BILLING_MODE=live` on before the store products exist is safe: with
nothing on sale the app finds no packages, hides the purchase sheet and the
restore row, and the paywall carries on with the receipt rail. Nothing on screen
claims a store purchase is possible until one really is.

## 3. Staff access

The first `super_admin` comes from `seed:staff` (§0.5). It is the only staff
account made outside the console. Everyone after it is granted from Admin →
Staff, with no SQL and no seed script.

| Console | Where | Who gets in |
|---|---|---|
| Admin | `/admin` (web) or the in-app Staff hub | `super_admin`, `main_admin` and the sub-roles, each seeing only what their role allows |
| Coach | `/coach` (web) or the in-app Staff hub | `role='coach'` accounts |
| Partner | `/partner` (web only) | restaurant partner accounts, scoped to their own restaurant |

If you inherited a running deployment rather than bootstrapping one, change
every staff password you did not choose yourself before launch: Admin → Members
→ credentials.

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

## 5. Security sweep follow-ups

None were deploy blockers. Numbering is kept so older notes still line up; the
ones since closed say so, and 2, 5 and 6 are the three that are still open.

1. **Rate-limit auth endpoints.** Done. Every credential route counts attempts, sign-in counts them per account as well as per IP, and staff step-up re-auth counts them per account. All of it becomes one shared budget once the Redis variables above are set; until then each warm instance counts on its own, so set them.
2. **Cloudinary free-tier signed URLs don't expire** — a captured playback URL works forever. Acceptable at launch (assets are `authenticated`; unsigned URLs 401). Fix later via Cloudinary token auth (paid) or periodic `api_secret` rotation (invalidates all old URLs).
3. **Mobile session token at rest** — done. On a phone the persisted store is MMKV encrypted with AES-256, and the key lives in the OS keychain or keystore via `expo-secure-store` (`apps/mobile/src/lib/mmkvStorage.ts`). If secure storage is unavailable it fails closed to process memory, so a bearer token is never written to disk in the clear. The web build still uses `localStorage` through AsyncStorage, which is the platform's own limit.
4. **Suspended accounts at sign-in** — done. `/api/auth/login` runs `canCreateSession(status)` before minting anything, so a suspended account gets the same `bad_credentials` 401 as a wrong password and no session row is created.
5. **Nightly off-provider DB backup** (`pg_dump` → R2) — the plan's Phase 0 item, still the highest-priority ops gap. Nothing in the repo does this today.
6. **Restores rely on a webhook event.** The webhook only acts on the purchase
   lifecycle events it knows (`INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`,
   `UNCANCELLATION`, `CANCELLATION`, `EXPIRATION`, `SUBSCRIPTION_EXTENDED`). A
   restore that produces only a `TRANSFER` (the same purchase moving to another
   account) leaves the server unaware, so the app tells the member to contact
   support instead of claiming the membership is back. Closing this needs a
   server-side read of RevenueCat's subscriber API, or handling `TRANSFER`;
   until then support can grant the window from Admin → Members.
