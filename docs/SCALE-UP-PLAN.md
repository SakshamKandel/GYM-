# SCALE-UP PLAN — coach marketplace, promo economy, admin completion

## STATUS (2026-07-12)

W1-W6 executed. Coach enrollment + verification + tiers, promo codes + coach
wallets + 30/30 economy, regional pricing (NP/INTL) + admin pricing editor,
manual payment requests (eSewa/Khalti receipts), coach-assigned workouts +
diet plans, admin support inbox, friend DMs, buddy-session + referral-discount
fixes, and the onboarding permission step are all built in the working tree
(uncommitted). Image uploads (avatars, receipts, progress photos) ship via
Cloudinary — see docs/DEPLOY.md for the now-load-bearing
`CLOUDINARY_URL_SIGNING_KEY`. Still deferred, per §9 below: RevenueCat SDK +
store billing, real payout rails (payouts stay manual ledger entries),
ratings/reviews, multi-coach per member, websockets, RLS, a data-driven
permission engine, and nightly DB backups (flagged separately as the top
ops gap). The rest of this document is the original plan and is left as
written for history.

Author: Fable (architecture + logic). Executors: Sonnet agents, one workstream at a
time, following this document exactly. When this doc and older docs disagree, this
doc wins; when this doc and CLAUDE.md hard rules disagree, CLAUDE.md wins.

Goal: evolve GYM Tracker from a Greece-Maharjan-centric app into a multi-coach
platform: self-serve coach enrollment with admin verification, coach seniority
tiers, coach promo codes with a 30% wallet commission and 30% user discount,
coach-assigned exercise + diet programs for premium clients, a complete admin
panel (incl. support inbox + promo management + regional pricing), friend chat,
and fixes for the buddy-session and referral-discount bugs plus steps UX.

## 0. Current-state anchors (verified 2026-07-12)

- Schema: `packages/db/src/schema.ts` (single file, ~1050 lines). Accounts-keyed
  modern tables; `profiles`-keyed tables are legacy/dead. NO migration files —
  `pnpm --filter @gym/db db:push` only. 3 columns already pending push
  (accounts.tier_started_at, tier_expires_at, plan_videos.views).
- Tier writes ONLY via `setAccountTier()` (`apps/web/src/lib/tier.ts`) — mirrors
  jsonb, syncs Greece elite auto-assign, audits. Expiry via `effectiveTier()` at
  auth choke points, no cron.
- Staff = row in `admins` (role enum text col: super_admin(3) > main_admin(2) >
  member/nutrition/content/support_admin, coach (1)). Guards:
  `requireStaff/requirePermission/requireOutranks/requireCoachOwnsUser` in
  `apps/web/src/lib/authz.ts` (hardcoded matrix, fail closed).
- Pricing today: hardcoded NPR placeholders in
  `packages/shared/src/logic/gmMethod.ts` `GM_TIERS.pricePerMonthNpr`
  (0/999/1999/4999). No server pricing, no currency logic, no discounts.
- Billing: `BILLING_MODE` preview (default; free self-serve picks) vs live
  (RevenueCat webhook only; RC SDK NOT installed in mobile). No real money moves.
- Uploads: ONLY direct-creator video uploads via hand-rolled Cloudinary/CF-Stream
  provider (`apps/web/src/lib/video/`). No image uploads anywhere.
  `coach_profiles.avatarUrl` exists, rendered in 4+ places, but has no write path.
- Chat: single `coach_messages` table (accountId + kind coach_chat|support,
  sender user|coach). Support kind is write-only (no staff inbox). PII masking via
  `maskPii()` server-side before storage.
- Exercises: 873 bundled free-exercise-db entries client-side; server `exercises`
  table exists but is UNSEEDED (FK hazard). Plans are client seed constants;
  server plans tables dead. Nutrition fully local; no coach visibility.
- Known bugs (root-caused, see §7): buddy join raw-vs-effective tier + invisible
  participants; referral discount is UI copy with no engine behind it.

## 1. Product decisions (owner requirements → concrete policy)

### 1.1 Regional pricing (server-driven)

Two price regions. Client sends a region hint (`expo-localization` country code);
server clamps: `NP` → NPR catalog, everything else → INTL (USD). Prices live in
DB table `tier_prices` (admin-editable), seeded from shared constants:

| tier   | NP (NPR/mo) | INTL (USD/mo) | notes |
|--------|------------:|--------------:|-------|
| starter| 0           | 0             | free forever |
| silver | 499         | 4.99          | was 999 NPR — cheaper for Nepal per owner |
| gold   | 999         | 9.99          | was 1999 NPR |
| elite  | 2999        | 29.99         | was 4999 NPR; includes 1-on-1 coaching |

Amounts stored in MINOR units (paisa/cents) + ISO currency. Rationale: Nepali
consumer fitness apps clear at NPR 300–1000/mo; international comparables
(Strong/Hevy premium) $5–10/mo; coached tiers far under typical online-coaching
$50+/mo to drive volume through coach promo codes.

### 1.2 Entitlement matrix (reallocated)

Keep existing keys; add two new `Feature` keys and re-point two:

- NEW `coach_workouts` → minTier **silver** (coach-assigned exercise sections;
  ALSO requires an active coach assignment — checked separately, not via tier).
- NEW `coach_diet` → minTier **gold** (coach-assigned diet plans; also requires
  active coach).
- `custom_meal_plan` stays elite (Greece 1-on-1 bespoke); `meal_plans` stays gold.
- The 873-exercise library, logger, universal seed plans, buddy system, friend
  chat, steps: FREE (starter) — explicitly per owner ("800 exercises universal").

### 1.3 Promo economy

- Every VERIFIED coach automatically gets one promo code (uppercase, 6–12 chars,
  generated `NAME`+2 digits, collision-retry). Coach codes: `discountPct=30`,
  `commissionPct=30`.
- Admins can create arbitrary house codes (any pct 5–90, no commission owner,
  optional maxRedemptions/expiry) — covers the owner's "20% off" ask.
- Redemption: one per account per code; entering a code creates a
  `discount_grants` row (see §2) that the pricing catalog applies automatically.
  Only ONE active grant per account — best discount wins, newest breaks ties.
- Commission: when a paid grant lands (preview self-serve pick, admin-approved
  payment request, or future RevenueCat purchase) the post-grant hook computes
  `commissionMinor = round(pricePaidMinor * commissionPct/100)` and appends a
  wallet ledger credit to the code-owning coach. Idempotent per redemption.
- Referral program (existing buddy referrals): when a referral reaches `joined`,
  BOTH referrer and invitee get a 20% `discount_grants` row (source `referral`),
  single-use, 90-day expiry. This makes the existing UI copy true.

### 1.4 Coach lifecycle

- Any member may apply from the app (form + profile photo). One open application
  per account.
- Admin verifies: approve → grants `admins.role='coach'`, upserts
  `coach_profiles` from the application (incl. avatar), sets `coachTier`
  (default silver), generates the promo code, audits. Reject → status + note.
- Coach tiers: `silver | gold | elite` on `coach_profiles.coachTier` (seniority
  badge, NOT money). Admin can change it anytime; coach can request an upgrade
  (`coach_tier_requests`, one pending max) which admin approves/rejects.
- Member-facing coach profiles: achievements/certs/specialties/years/avatar/tier
  badge ONLY. Never emails/contacts (server already omits; keep it that way; fix
  the web coach-console email leak by showing displayName + id instead).

### 1.5 Nepal payments (until store billing exists)

`payment_requests`: user picks tier + duration (1/3/12 months) on the paywall,
sees the regional price (minus discount), pays via eSewa/Khalti/bank outside the
app, uploads the receipt image, submits. Admin queue approves → dated
`setAccountTier` for the window + commission hook; rejects with note. Works in
both BILLING_MODE modes; in live mode this is the only paid path for NP.

## 2. Data model changes (all in packages/db/src/schema.ts; additive only)

New columns:
- `coach_profiles.coachTier` text default 'silver' (ts enum CoachTier
  'silver'|'gold'|'elite').
- `accounts.country` text nullable (ISO-3166 alpha-2, set from client hint at
  login/me refresh; used for default region + admin analytics).

New tables (accounts-keyed, follow existing naming/index conventions):
1. `coach_applications` — id uuid, accountId FK, displayName, headline, bio,
   yearsExperience int, specialties jsonb, certifications jsonb, achievements
   jsonb, avatarUrl text null, status text 'pending'|'approved'|'rejected'
   default pending, reviewNote text null, decidedBy FK null, decidedAt, createdAt.
   Partial-unique: one non-rejected application per account (enforce in route,
   like coach_requests pattern).
2. `coach_tier_requests` — id, coachId FK, requestedTier, note, status
   pending|approved|rejected, decidedBy, decidedAt, createdAt. One pending per
   coach (route-enforced).
3. `promo_codes` — id, code text unique (store uppercase), ownerCoachId FK null,
   discountPct int, commissionPct int default 0, active bool default true,
   maxRedemptions int null, redemptionCount int default 0, expiresAt null,
   createdBy FK null, createdAt. Index on ownerCoachId.
4. `promo_redemptions` — id, codeId FK, accountId FK, status
   'reserved'|'applied' default reserved, purchaseAmountMinor int null, currency
   text null, commissionMinor int null, appliedAt null, createdAt.
   unique(codeId, accountId).
5. `discount_grants` — id, accountId FK, source text ('referral'|'promo'),
   promoCodeId FK null, pct int, status 'active'|'consumed'|'expired' default
   active, expiresAt null, consumedAt null, createdAt. Index (accountId, status).
6. `wallet_ledger` — id, coachId FK, type 'commission'|'adjustment'|'payout',
   amountMinor int (negative for payout), currency text, sourceType text null
   ('promo_redemption'|'admin'), sourceId text null, note text null, createdBy FK
   null, createdAt. unique(sourceType, sourceId) WHERE sourceType IS NOT NULL —
   idempotency (drizzle: uniqueIndex on both cols; enforce null-skip in code).
   Balance = SUM per coach per currency (no materialized balance).
7. `tier_prices` — id, region text ('NP'|'INTL'), tier, amountMinor int,
   currency text, active bool default true, updatedBy FK null, updatedAt.
   unique(region, tier).
8. `payment_requests` — id, accountId FK, tier, months int, region, amountMinor,
   currency, method text ('esewa'|'khalti'|'bank'|'other'), receiptUrl text,
   note text null, promoCodeId FK null, status pending|approved|rejected,
   reviewNote null, decidedBy null, decidedAt null, createdAt.
   Index (status, createdAt).
9. `coach_assigned_workouts` — id, coachId FK, clientId FK, title, notes text
   default '', position int default 0, status 'active'|'archived' default
   active, items jsonb (array of {exerciseId: string|null, name: string, sets:
   int, repRange: string, restSec: int, note?: string, imageUrl?: string}),
   createdAt, updatedAt. Index (clientId, status), (coachId, clientId).
10. `coach_diet_plans` — id, coachId, clientId, title, notes, status
    active|archived, meals jsonb (array of {meal:
    'breakfast'|'lunch'|'dinner'|'snacks', items: [{name, qty, kcal?, protein?,
    carbs?, fat?, note?}]}), createdAt, updatedAt. Same indexes.
11. `buddy_messages` — id, linkId FK buddy_links (cascade), senderAccountId FK,
    body text, readAt timestamp null, createdAt. Index (linkId, createdAt).
12. `progress_photos` — id, accountId FK cascade, takenOn date (YYYY-MM-DD
    string, same style as coach_milestones.achievedAt), imageUrl text, note text
    default '', createdAt. Index (accountId, takenOn).

Support inbox reuses `coach_messages` kind='support' — add nothing; ticket-state
lives in new columns? NO — keep zero-migration simplicity: resolved-state =
`readByCoach` (unread == open work) for v1.

After schema lands: run `pnpm --filter @gym/db db:push` ONCE (also flushes the 3
pending columns). Additive only — verify no destructive prompts.

## 3. Shared logic changes (packages/shared)

- `logic/entitlements.ts`: add `coach_workouts` (silver) + `coach_diet` (gold)
  to Feature + FEATURE_MIN_TIER. Tests updated.
- NEW `logic/pricing.ts`: `PriceRegion = 'NP'|'INTL'`; `DEFAULT_TIER_PRICES`
  (the §1.1 table, minor units); `resolveRegion(countryHint)`;
  `applyDiscount(amountMinor, pct)` (round half-up, floor 0);
  `formatMoney(amountMinor, currency)` using Intl fallback-safe formatting
  ("NPR 499", "$4.99"). Unit tests (rounding, region clamp).
- `logic/gmMethod.ts`: GM_TIERS keeps feature copy but DROP price authority —
  `pricePerMonthNpr` stays temporarily for backward compat but paywall stops
  reading it (delete once paywall migrated; leave one deprecation comment).
- `logic/promo.ts` NEW: `generatePromoCode(name)`, `normalizePromoCode(input)`
  (trim/uppercase/`[A-Z0-9]{4,16}` validate). Tests.

## 4. API surface (apps/web/src/app/api) — new/changed routes

Conventions for ALL new routes: zod-validate body/query; `authedUser` (member) or
`requirePermission` (staff); rate-limit mutating member routes; `logAudit` on
staff mutations; never expose emails on member-facing payloads; PII-mask free
text stored from members via `maskPii` (application bio/achievements, tier
request note, payment note — NOT friend DMs, see §6.4).

New permissions in authz.ts matrix: `support.thread.read`, `support.thread.reply`
(support_admin + super/main), `promo.manage`, `pricing.manage`,
`payments.review`, `coach.application.review` (member_admin + super/main; promo
+ pricing super/main only), coach role additionally gets `coach.wallet.read` (own
wallet implied by principal — route self-scopes).

### 4.1 Pricing + promo + payments
- GET `/api/subscription/catalog?region=XX` (member auth): resolves region
  (param → account.country → INTL), reads tier_prices (fallback
  DEFAULT_TIER_PRICES), finds best active non-expired discount_grant, returns
  `{ region, currency, tiers: [{tier, amountMinor, discountedMinor?,
  discountPct?, discountSource?}], trialDays }`. Also persists
  `accounts.country` when param present and differs.
- POST `/api/promo/redeem` {code} (member, 10/hr): validate active code, window,
  maxRedemptions, not own code (coach can't redeem own), one redemption per
  account per code, insert redemption (reserved) + discount_grant (supersede
  older active grants with status 'expired'). Returns catalog-shaped discount
  info. Uniform errors: invalid_code | already_used | expired.
- POST `/api/payments/requests` {tier, months, method, receiptUrl, note?, region}
  (member, 5/day): computes amountMinor server-side from catalog (with active
  grant), stores request. GET lists own (for status UI).
- Admin: GET/POST `/api/admin/promo-codes` (list w/ redemption stats; create
  house or coach code), PATCH `/api/admin/promo-codes/[id]` (active toggle,
  limits); GET `/api/admin/payment-requests?status=`, POST
  `/api/admin/payment-requests/[id]` {action: approve|reject, note} — approve:
  dated setAccountTier(months window, reason 'payment_request') + promo
  consumption hook; GET/PUT `/api/admin/pricing` (upsert tier_prices rows).
- Wallet: GET `/api/coach/wallet` (own ledger + balances per currency); admin
  GET `/api/admin/wallets` (per-coach balances), POST
  `/api/admin/wallets/[coachId]/entries` {type: adjustment|payout, amountMinor,
  currency, note} (audited).
- Commission hook `apps/web/src/lib/promo.ts` `settlePromoOnPurchase(accountId,
  tier, amountMinor, currency, mode)`: called from (a) subscription/tier route
  after paid preview grant, (b) payment-request approve, (c) revenuecat webhook
  (compute amount from catalog since RC price is stripped — note in code).
  Consumes grant (consumed), marks redemption applied, ledger-credits coach
  (idempotent via unique sourceId=redemptionId). Referral grants consume with no
  ledger entry.
- Referral fix wiring (§7.2): in `auth/register` + `auth/google` after account
  creation: match `referrals.inviteeEmail`, set inviteeId + status 'joined'; on
  'joined' transition (both here and in the existing immediate-join path in
  buddy/referrals POST) create the two 20% discount_grants + set status
  'rewarded'/rewardedAt when grants are created. GET referrals response gains
  grant status so UI stays truthful.

### 4.2 Coach lifecycle
- POST `/api/coach-applications` (member, one open app, maskPii text fields);
  GET own latest (status screen); admin GET
  `/api/admin/coach-applications?status=`, POST
  `/api/admin/coach-applications/[id]` {action: approve|reject, coachTier?,
  reviewNote?} — approve runs the §1.4 sequence in one transaction-ish flow
  (role upsert → profile upsert → promo code gen → audit; tolerate partial
  retry).
- POST `/api/coach/tier-requests` {requestedTier, note} (coach; one pending);
  GET own history. Admin GET/POST `/api/admin/coach-tier-requests[/id]`
  approve/reject (approve writes coach_profiles.coachTier + audit).
- PATCH `/api/coach/profile`: accept `avatarUrl` (validated https URL from our
  upload route response). Admin PATCH `/api/admin/coaches/[id]` NEW: isActive,
  coachTier, capacity overrides (audited) — fills the "no admin edit" gap.
- Member-facing: `/api/coaches` + `/api/coaches/[id]` include `coachTier` badge
  field. Sorting: elite first, then gold, silver, then by activeClients.

### 4.3 Assigned programs + diet
- Coach (all `requireCoachOwnsUser`): GET/POST
  `/api/coach/clients/[userId]/workouts`, PATCH/DELETE
  `/api/coach/workouts/[id]`; same shape for `/diet-plans` +
  `/api/coach/diet-plans/[id]`. Items zod: exerciseId optional string (no FK —
  matches synced_sets pattern; server exercises table stays unseeded), name
  1..80, sets 1..10, repRange like '5' or '8-12', restSec 15..600, imageUrl
  optional https, note ≤200. Meals zod similarly bounded (≤6 meals, ≤12 items
  each).
- Member: GET `/api/me/coach-workouts`, GET `/api/me/coach-diet` — 403
  `{error:'locked', requiredTier}` when tier below feature minimum (server-side
  gate mirrors plan-videos pattern); empty list when no coach.
- Push on assign/update: data type `coach_plan` → pushRefresh reload.

### 4.4 Support inbox + friend chat
- Admin support: GET `/api/admin/support/threads` (accounts having kind=support
  messages; last body/at + unreadCount via readByCoach=false), GET/POST
  `/api/admin/support/threads/[accountId]` (list+mark readByCoach / reply —
  insert kind support sender coach senderAccountId=principal, push
  `support_reply`, audit). Permission `support.thread.*`. Member `GET
  /api/coach/messages` marks `readByUser=true` for returned coach-sender rows
  (both kinds — fixes dead unread flag); member unread endpoint: extend GET
  `/api/me` payload? NO — keep me lean; add GET `/api/me/unread`
  {support, coachChat, buddyThreads:[{linkId,count}]} single cheap endpoint.
- Support access: server POST gate for kind='support' relaxes to ANY signed-in
  user (rate-limit 5/min) — priority copy for elite stays client-side;
  `support.tsx` drops the elite entitlement gate for the message section.
- Friend DMs: GET `/api/buddy/threads` (accepted links + last msg + unread),
  GET `/api/buddy/threads/[linkId]?after=` (member of link only; marks readAt),
  POST `/api/buddy/threads/[linkId]` {body ≤2000} (30/min; push type
  `buddy_message`). NO PII masking (mutually-accepted contacts), but body
  trimmed/length-bounded; blocked users = unlink (existing DELETE).

### 4.5 Uploads (images)
- Extend `apps/web/src/lib/video/cloudinaryProvider.ts` (+types/index) with
  `createImageUpload(kind)` → signed direct-upload (resource_type image,
  folder per kind; `type: 'upload'` public for avatar/exercise/diet images;
  `type: 'authenticated'` for progress photos + receipts) and
  `signedImageUrl(uid)` for authenticated kinds.
- POST `/api/uploads/image` {kind: 'coach_avatar'|'application_avatar'|
  'custom_exercise'|'diet_item'|'progress_photo'|'payment_receipt'} — member
  auth; per-kind authorization (coach kinds require coach role or open
  application intent — application_avatar allowed for any member); returns
  {uploadUrl, fields, uid, deliveryUrl?}. Client uploads bytes direct to
  Cloudinary (Vercel body limit stays respected), then passes
  deliveryUrl/uid to the owning API.
- Progress photos: GET/POST `/api/me/photos` (+DELETE `/api/me/photos/[id]`),
  coach read `GET /api/coach/clients/[userId]/photos`
  (requireCoachOwnsUser; signed URLs minted per request).

## 5. Mobile app changes (apps/mobile)

REVAMP-BRIEF visual rules apply everywhere (one red hero, no borders, tokens
only, no glow). Feature-module isolation. All new API calls in
`src/lib/api/*` or `src/features/*/api.ts` with zod schemas.

### 5.1 Member-facing
- Paywall `features/subscription/SubscribeScreen.tsx` + TierDetailSheet: fetch
  catalog on mount (region hint from `expo-localization`), render per-region
  currency with `formatMoney`; struck-through base + discounted price + source
  chip ("Promo GREECE30 −30%" / "Referral −20%") when present; promo-code entry
  field (redeem → refetch catalog); "Pay via eSewa/Khalti" flow for NP region →
  receipt image picker → uploads/image → POST payments/requests → pending state
  screen; keep preview self-serve button while BILLING_MODE=preview.
  DROP direct GM_TIERS price reads.
- Coaches: application form screen `app/coaches/apply.tsx` (photo picker +
  portfolio fields, reuses coach profile editor components where sane); "Apply
  to coach" entry on coaches index; application status card. Coach cards +
  detail: coachTier badge (Elite/Gold/Silver chip), NO contact info.
- Train tab: "From your coach" section listing assigned workouts (gate:
  hasEntitlement coach_workouts + has coach; locked → UpgradePrompt); start →
  existing session flow via planExerciseToSession-shaped items.
- Food tab: "Coach diet plan" card (gate coach_diet) → diet plan screen
  (meals/macros; read-only).
- Buddy tab: chat icon per accepted buddy → `app/buddy/chat/[linkId].tsx`
  reusing MessageBubble/CoachThread patterns; 12s poll while open; unread badges
  from /api/me/unread.
- Progress: progress-photos section (silver+ per existing progress_photos
  entitlement) — capture/pick, list by date, delete.
- Support screen: message section for all users (elite keeps priority copy);
  unread badge.
- Steps (§7.3) + onboarding permission step (§7.3).

### 5.2 Coach console (mobile `app/staff/coach`)
- index: wallet balance card (per-currency) + own promo code card (copy button,
  redemptions count, "30% off for them, 30% for you" caption).
- profile: avatar picker (upload → PATCH avatarUrl); coachTier badge display;
  "Request tier upgrade" sheet (one pending).
- client/[userId]: two new sections — Assigned workouts (list/create/edit:
  exercise picker from local library + custom name + sets/reps/rest + optional
  image) and Diet plan (meal builder). Push notifies client.
- NEW `wallet.tsx`: ledger list + balances.

### 5.3 Staff admin (mobile `app/staff/admin`)
- Fix hub: Subscriptions row routes to the real subscriptions screen; add rows:
  Applications, Support inbox, Promo codes, Payments (role-gated).
- NEW screens: applications.tsx (queue + approve w/ tier picker + reject),
  support.tsx (threads + reply), payments.tsx (receipt view via signed URL +
  approve/reject), promos.tsx (list/create/toggle).
- audit.tsx: fix broken quick-filter chips (exact-match mismatch) — chips send
  exact action names.

### 5.4 Web admin (apps/web/src/app/admin)
- NEW pages: Applications (queue/detail/approve/reject), Promo codes
  (CRUD + stats), Payments (receipt preview + decide), Support (inbox + thread),
  Wallets (balances + manual adjustment/payout entry), Pricing (region×tier
  editor) — follow existing console component kit + per-page role gates.
- Coaches page: coach detail gains Edit (isActive, coachTier, capacity) +
  wallet link + tier-request queue.
- Nav: add sections with role filters (support_admin sees Support; member_admin
  sees Applications/Payments; super/main see all incl. Pricing/Promos/Wallets).

## 6. Cross-cutting rules for executors

1. NEVER write `accounts.tier` directly — always `setAccountTier`.
2. Every new coach-scoped route: `requirePermission` + `requireCoachOwnsUser`.
3. Member-facing payloads never include emails. Web coach console: replace
   client-email fallback with displayName ("Client" + short id).
4. zod at every boundary (server body/query; mobile response schemas).
5. Money is integers (minor units) + currency code strings. No floats.
6. Audit every staff mutation (`logAudit`), reuse action naming style
   (`promo.create`, `coach.application.approve`, `payment.approve`,
   `wallet.adjust`, `support.reply`, `pricing.update`, `coach.tier.change`).
7. Additive schema only; single `db:push` after schema workstream; never edit
   legacy profiles-keyed tables.
8. Mobile: tokens only, no borders on cards, one red hero per screen, AppText,
   ≥48dp targets. `pnpm typecheck && pnpm lint && pnpm test` must pass.
9. Push notifications: reuse `sendPushToAccount` inside `after()`; new data
   types: `support_reply`, `buddy_message`, `coach_plan`, `application_decided`,
   `payment_decided`, `tier_request_decided` — mobile pushRefresh maps each to
   the right store reload.
10. Rate limits on every member-mutating route (reuse rateLimit lib).

## 7. Bug-fix specifications (P0)

### 7.1 Buddy sessions (4 defects — file:line evidence verified)
- `api/buddy/sessions/[id]/join/route.ts:53-61`: select `tier` +
  `tierExpiresAt`, compare `effectiveTier(host...) !== me.tier`.
- Participants visible: GET `/api/buddy/sessions` joins participants (id,
  displayName, isMe flag); mobile `buddySessionSchema` + cards show participant
  chips; after successful join the button flips to "Joined ✓" (participant
  membership drives state, not reload no-op). Host card lists joined buddies.
- join route: replace bare `catch {}` with unique-violation-only tolerance
  (rethrow → 500 otherwise).
- `features/buddy/hooks.ts:90`: sessions fetch failure must set `stale` (remove
  silent `[]` swallow).
- Hygiene: GET list filters `startedAt > now() - interval '12 hours'`.

### 7.2 Referral discount (make the promised 20% real)
Implemented via discount_grants + catalog (§4.1). Definition of done: referral
row 'joined' ⇒ both parties see "−20%" on the paywall within one catalog fetch,
price math server-side, purchase consumes the grant, row flips 'rewarded'.

### 7.3 Steps + permissions UX
- Onboarding: new step between days/week and plan reveal — "Stay on track":
  explainer + single CTA firing notification permission then step permission
  (+ Health Connect request on Android when available); skippable ("Later").
- `_layout.tsx:81-95`: registerForPushNotificationsAsync must NOT prompt —
  split: `getPermissionsAsync` only; token registration proceeds when granted.
  FirstWorkoutsQuest + streak-saver schedulers: no-prompt variants (check-only).
- Steps sheet: manual block becomes +/- corrections: quick chips `−500` `+500`
  and stepper add/subtract via new `adjustManualSteps(delta)` (hooks.ts drops
  `n<=0` guard; sqlite clamp already safe). "Enable step tracking" button stays
  ONLY as re-ask when permission denied. HC path: keep auto (unchanged, hidden
  manual controls).

## 8. Execution workstreams (Sonnet fleets; verify between each)

- W1 P0 bugs (§7.1 + §7.3): isolated files, no schema. Verify: typecheck +
  targeted review + expo web smoke (buddy tab, onboarding, steps sheet).
- W2 Foundation: schema.ts (one agent, all §2) → db:push → parallel: shared
  logic (§3) / image uploads (§4.5) / catalog+discounts+referral wiring (§4.1
  part) / paywall catalog consumption (§5.1 paywall). Verify: unit tests +
  catalog endpoint smoke + paywall renders regional prices.
- W3 Coach lifecycle + promo economy: §4.2 + promo/payments/wallet routes +
  §5.2 coach console + §5.4 applications/promos/payments/wallets/pricing admin
  pages + §5.3 mobile staff. Heavy parallel tracks with disjoint files.
- W4 Assigned programs + diet: §4.3 + Train/Food sections + coach builders.
- W5 Comms: support inbox (server+web+mobile) + friend chat + unread endpoint.
- W6 Sweep: web admin polish items (member pagination, audit filters, hub
  misroutes), docs update, full test pass, end-to-end smoke script.

Each workstream ends with: `pnpm typecheck && pnpm lint && pnpm test` green,
adversarial code review of the diff, fixes applied, and a browser smoke of the
touched surfaces (expo web via gym-web preview + web admin via next dev).
NO git commits without the owner's explicit go-ahead.

## 9. Out of scope (explicitly deferred)

RevenueCat SDK install + store products; real payout rails (eSewa/Khalti API
disbursement — payouts recorded as manual ledger entries); ratings/reviews;
multi-coach per member; websockets; RLS; data-driven permission engine; nightly
backups (still the top ops gap — flag to owner separately).
