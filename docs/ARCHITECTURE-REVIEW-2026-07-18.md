# GYM Platform — Architecture Review & Remediation Plan (2026-07-18)

*Principal Architect synthesis of 28 per-surface audits, cross-checked against the working tree (apps/web, apps/mobile, packages/shared, packages/db). Root-cause chains for the three reported breakages were re-verified directly in source before writing.*

---

## 1. Executive Summary

The platform is **feature-complete and structurally sound at the money/data layer, but degraded at the console/contract edges** — most damage is UI gates, missing web pages, and web↔mobile schema drift, not core logic. Server-side money movement (CAS transitions, idempotent ledger inserts, refund reversal ordering, extend-vs-overwrite tier windows) and API-level permission enforcement (fail-closed, override-aware, no retired `content.video.publish` key in any live guard) are genuinely strong.

**Top 5 risks:** (1) `main_admin` preset permissions can be stripped by a per-account override (`authz.ts:104` never floors main_admin), a lockout + privilege-inconsistency hole; (2) the **video pipeline is structurally dead** — `plan_videos.exercise_id` FKs an unseeded `exercises` table the create-route regex cannot even populate — this is the real "content_admin cannot add videos"; (3) money-review **403-traps and a total mobile-overview contract break** strand admins, and web refund fires with **zero confirmation**; (4) **meal-delivery ops are blind** — the admin `/admin/meal-payments` page 404s, and neither partner nor admin has any subscription roster; (5) **coach↔member chat looks broken from the coach's seat** — the web thread is a static render with no live refresh.

**Top 5 wins:** (1) money server logic is retry-safe and race-guarded; (2) permission enforcement at the API is uniformly fail-closed; (3) coach mentorship, PII masking, and DB-side ownership re-derivation (`requireCoachOwnsUser`) are correct end-to-end; (4) the **mobile staff console repeatedly exceeds web on safety** (reauth step-up, suspend reasons, capacity display); (5) zod/schema discipline is high with lenient additive-column parsing and keyset pagination backed by matching indexes.

---

## 2. System Architecture (current state)

### 2.1 Surfaces & runtimes

```
┌─────────────────────────── apps/web (Next.js App Router, Node runtime) ───────────────────────────┐
│  /admin   → console (~24 pages): members, coaches, applications, payments, meal-payments*, payouts,│
│             wallets, subscriptions, pricing, promos, abuse, broadcast, gamification, catalog,      │
│             content, gyms, partners, support, analytics, audit, staff       (*nav-linked, no page) │
│  /coach   → coach portal: dashboard/attention/review/verify/flags/challenges/clients/threads/videos│
│  /partner → partner portal (WEB-ONLY BY DESIGN): today board, menu, subscriptions, earnings, profile│
│  /api/**  → THE CONTRACT LAYER. Mobile talks to Neon only through these routes (CLAUDE.md rule).   │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────── apps/mobile (Expo, expo-router) ───────────────────────────────────────┐
│  member app  → train / food / meals / gyms / progress / coach-chat                                 │
│  /staff      → admin console (parity screens) + coach console; partner sees "manage on web" notice │
│  features/staff/{api.ts, supportApi.ts, nav.ts}  → zod schemas that MUST mirror /api/** JSON shapes │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
   packages/shared → zod + permissions (ALL_PERMISSIONS, ROLE_PRESETS, effectivePermissionSet, maskPii)
   packages/db     → Drizzle + Neon; db:push only (NO migration files) → DB can lag schema.ts
```

### 2.2 Roles & permission model

```
super_admin ─ bypasses matrix unconditionally (floored in effectivePermissionSet)
main_admin  ─ INTENDED to bypass unconditionally … but currently flows through override removal (BUG, WP-1)
sub-roles   ─ member_admin · support_admin · content_admin · nutrition_admin · coach · partner(rank-0, web-only)
overrides   ─ per-account permissions.override GRANT/DENY, merged in lib/authz.ts effectivePermissionSet()

Enforcement:  web routes → requirePermission / requireAnyPermission (fail-closed)
              web pages   → effectivePermissionSet + redirect (fail-closed, no 403-trap when done right)
              mobile      → staffCan(serverEffectivePermissionList, key)
Auth carrier: web = staff cookie session · mobile = bearer token
```

### 2.3 Data domains

Membership/Tiers · Coaching & Mentorship · **Payments** (NP manual eSewa/Khalti/bank receipt queue + coach wallet/payouts + refunds) · **Meal Delivery** (partners→meals→orders→subscriptions→billing_cycles→meal_payments) · Gyms directory · Content/Video · Gamification · Support · Audit · Promo/Referral/Abuse.

### 2.4 web↔mobile contract layer (the drift surface)

Mobile `features/staff/api.ts` holds hand-maintained zod schemas that must match each `/api/**` JSON shape byte-for-byte. When a web route reshapes its payload and mobile isn't updated, the mobile screen throws on `parse()` and shows a permanent error state. **This is a live failure today** (admin overview) and a latent one on every capped list route. Treat `/api/**` response shapes as a **frozen contract** and change them only in lockstep with `features/staff/api.ts`.

---

## 3. Findings Matrix

Status: **OK** = works end-to-end · **DEGRADED** = works but has major defects/gaps · **BROKEN** = a primary flow is dead.

| Surface | Status | Top issue | Mobile parity |
|---|---|---|---|
| Admin overview | **BROKEN** | Mobile schema (flat) ≠ route shape (nested) → every admin-home load throws | **BROKEN** (total contract break) |
| Admin members + drawer | DEGRADED | Credentials gate ignores overrides + no rank-lock; assign has no `force`; view-as unlinked | Ahead of web (reauth, reasons) |
| Admin coaches | DEGRADED | Edit/tier-request gated on `coach.assign` but API needs `coach.application.review` → 403-trap | Partial (coach edit is dead code) |
| Admin applications | OK | Mobile GET caps pending at 200 (C14 regression) | Full core parity |
| Admin payments | DEGRADED | Web refund fires with no confirm; mobile GET starves pending>200 | Ahead of web (confirm+reauth) |
| Admin payouts | DEGRADED | Queue gated on `wallet.manage` not `payouts.review` (both directions) | Ahead of web (own screen, notes) |
| Admin pricing | OK | `active` column never surfaced | Full parity |
| Admin promos | DEGRADED | Offboarded coach's code keeps earning/discounting | Solid parity |
| Admin subscriptions | DEGRADED | `tierStartedAt` silently wiped to null on every search-path save | Ahead (sidesteps the bug) |
| Admin wallets | **BROKEN** | Entry/payout 404s for any revoked coach — defeats the offboarded-coach flow | Inherits bug + drops revoked badge |
| Admin analytics | DEGRADED | Meal-delivery revenue absent from all revenue figures | **Absent** (no mobile screen) |
| Admin support | DEGRADED | Composer/resolve always enabled → 403-trap if reply stripped | Parity (no "All" tab) |
| Admin content/video | DEGRADED | Ready-flip fails closed on Cloudinary read-after-write 404 → stranded upload | Good contract parity |
| Admin catalog | DEGRADED | Clearing an optional field is a silent no-op | **Absent** (web-only) |
| Admin gamification | DEGRADED | "Active challenges" counts all-time rows | **Absent** (web-only) |
| Admin abuse/trials | DEGRADED | Reset needs a raw account UUID no page ever shows | **Absent** (web-only) |
| Admin broadcast | DEGRADED | `truncated` flag dropped; no audience-size preview | **Absent** (client built, no screen) |
| Admin audit | OK | CSV export ignores active filters | Parity (stale filter chips) |
| Admin staff & roles | **BROKEN** | Grant-role modal re-roles a coach → silent offboard cascade, no confirm | Weaker/less-safe; no override editor |
| Admin gyms | DEGRADED | Create form's Status/Verified controls silently dropped | **Absent** (web-only) |
| Admin partners | DEGRADED | `member_admin` can suspend a partner via Members drawer (gate bypass) | **Absent** (web-only) |
| Admin meal-payments | **BROKEN** | Nav link 404s — page was never built | Mobile complete; web missing |
| Partner today board | **BROKEN** | Non-today one-time orders become permanently invisible | N/A (web-only by design) |
| Partner menu | DEGRADED | `meals.own` override unenforced; duplicate-on-retry; blank price→free item | N/A |
| Partner subscriptions | **BROKEN** | No data layer, no route — restaurant blind to roster/skip/paid state | N/A |
| Partner earnings | DEGRADED | Full order total attributed to partner; no COD-vs-digital split; no payout path | N/A |
| Coach messages (web) | **BROKEN** | Static render, no live refresh → coach never sees inbound msgs ("not working") | Mobile more live (masks web bug) |
| Coach queues (attn/review/verify/flags/challenges) | DEGRADED | Flags "restore" action unreachable in UI | **Absent** (5 of 6 pages web-only) |
| Coach/member video consumption | **BROKEN** | plan_videos→exercises FK unseedable → upload never reaches members | Mobile makes it worse (picks bad id) |
| Member meals (mobile) | DEGRADED | Member commits to "Place order" without seeing delivery/total fees | N/A (member-only) |
| Mobile staff hub/nav | **BROKEN** | Zero-perm staff bounced on login ("login did nothing"); 5 perms open barren console | — |

---

## 4. Root Causes — the three reported breakages (verified file:line chains)

### 4.1 "Coach messages not working" (member ↔ coach chat)

**The messaging plumbing is correct; the coach's *web view* has no live delivery.** Verified in source:

```
apps/web/src/app/coach/threads/[userId]/page.tsx:13   export const dynamic = 'force-dynamic'   ← static server render
   :26  default async CoachThreadPage(...)   ← runs once per navigation; NO polling / websocket
   :50-61  loads FULL coach_chat history via getDb() every render
   :66-76  db.update(coachMessages).set({readByCoach:true})  ← MUTATION during RSC GET render
apps/web/src/app/coach/_components/ReplyBox.tsx:57  router.refresh()  ← the ONLY refresh, fires only AFTER the coach's own reply
```
A coach sitting on an open thread never sees a new inbound client message until they reply or hard-reload → reads as "messages not working." The mobile member side polls every 12s (`useCoachThread`), which is exactly why mobile testers can't reproduce it. Secondary defect: the mark-read `db.update` at lines 66-76 runs on any prefetch/RSC pre-execution of the thread URL (inbox rows are default-prefetch `<Link>`s), silently clearing the coach's unread work-queue badge before they actually read — re-introducing the GET-side-effect the separate `POST .../read` route was created to remove. Tertiary: `useCoachThread.ts:185` injects a "Greece is typing" bubble even when a human coach owns the reply, implying an instant answer that never comes.
→ **Fix in WP-10.**

### 4.2 "content_admin cannot add videos"

**Not an RBAC bug** (both `/api/admin/videos` guards admit `content.manage`, which content_admin holds; the retired `content.video.publish` key reaches no live guard). The real cause is a **structural FK break plus an un-guarded insert**, verified in source:

```
packages/db/src/schema.ts:750           plan_videos.exercise_id  FK → exercises(id)
apps/web/src/app/api/admin/catalog/exercises/route.ts:61   id regex = /^[a-z0-9-]+$/   (lowercase + hyphen ONLY)
   → member/bundled ids are Uppercase_With_Underscores (e.g. 'Barbell_Squat','3_4_Sit-Up')
   → an operator LITERALLY CANNOT create an exercises row whose id matches a member-visible exercise
   → the exercises table is also UNSEEDED (route doc-comment lines 14-19 confirm the app reads a bundled JSON, not this table)
apps/web/src/app/api/admin/videos/route.ts:89   reservation = getVideoProvider().createDirectUpload(...)  ← host slot reserved FIRST
   :98-123  db.insert(planVideos)...  ← NO try/catch around the insert
   → attaching any real exerciseId → FK violation → uncaught 500, surfaced as generic "Could not start the upload",
     leaving an orphaned reserved upload slot on the host.
```
So every exercise-attached upload fails; mobile makes it *more* reachable by presenting a picker (`staff/coach/videos.tsx:175`) that sends a guaranteed-bad bundled id. A separate, lower-probability trigger is environmental: when video hosting is unconfigured, `POST` returns `503 video_not_configured` (route.ts:91-93) and the UI disables "Add video" behind a banner.
→ **Fix in WP-9.**

### 4.3 "Meal-plan/subscription users have no proper management surface (partner or admin)"

Two independent holes, both verified:

**Admin half — the page does not exist:**
```
apps/web/src/app/admin/layout.tsx:46   { href:'/admin/meal-payments', label:'Meal Payments', perm:'payments.review' }
glob apps/web/src/app/admin/meal-payments/**  → ZERO files
```
The nav item 404s for every role that can see it. The API (`/api/admin/meal-payments/**`) and the mobile screen are both complete; only the web page was never built. Separately, there is **no admin surface at all** to inspect/pause/cancel an individual member's meal *subscription* (only payment review + order-fulfillment override exist).

**Partner half — no data layer, no route:**
```
glob apps/web/src/app/api/partner/**/route.ts → orders, meals, earnings, store   (NO subscriptions route)
apps/web/src/app/partner/subscriptions/page.tsx:40  renders only a bare integer (active-subscription count)
apps/web/src/app/partner/_data.ts  → never selects from mealSubscriptions / mealSubSkips / mealBillingCycles
```
The restaurant cannot see its subscriber roster, per-customer schedule, skip/pause state, or weekly billing-cycle status — so when a digital subscriber's order never materializes (the "never cook unpaid" gate in `materialize.ts:373`), the partner cannot tell *unpaid* from *skipped/paused/churned*.
→ **Fix in WP-11 (admin) + WP-8 (partner).**

---

## 5. Confirmed Defects (deduplicated)

### P0 — broken now

| # | Defect | Evidence | Fix | WP |
|---|---|---|---|---|
| P0-1 | `main_admin` preset perms strippable via per-account override → lockout + privilege inconsistency | `lib/authz.ts:104` (no main_admin short-circuit); `api/admin/staff/[accountId]/permissions/route.ts:105` | Floor main_admin like super_admin in `effectivePermissionSet`; DENY overrides may not remove preset perms for main_admin | WP-1 |
| P0-2 | Mobile admin-overview contract break — every admin-home load throws for every role | `features/staff/api.ts:995` (flat schema) vs `api/admin/overview/route.ts:132` (nested `{membership,ops,recentActivity}`) | Update mobile schema to read `membership.*`/`ops.*` | WP-12 |
| P0-3 | Partner `meals.own`/`orders.fulfill` override has zero enforcement effect | `lib/authz.ts:278` `requirePartner` checks only role + `isActive` | `requirePartner` also requires effective `{meals.own, orders.fulfill}` | WP-1 |
| P0-4 | Wallet entry/payout 404s for any revoked coach → offboarded-coach payout impossible | `api/admin/wallets/[coachId]/entries/route.ts:64` (rejects non-`coach` role) | Resolve coach by `coachProfiles`/historical ledger, not current `admins.role` | WP-3 |
| P0-5 | Web refund fires wallet clawback + tier rollback on a single click, no confirm | `admin/payments/_components/PaymentsQueue.tsx:670` | Add ConfirmDialog (+ optional reauth) before refund | WP-4 |
| P0-6 | Mobile payment-requests GET starves pending backlog >200 | `api/admin/payment-requests/route.ts:26` (flat cap incl. pending) | Unbounded-pending carve-out + per-status counts | WP-4 |
| P0-7 | Grant-role modal re-roles a coach → silent offboard cascade, no confirm | `admin/staff/_components/StaffManager.tsx:1173` (only row-select `:419` guards) | Shared offboard-impact gate on BOTH grant + row paths | WP-6 |
| P0-8 | Coach offboarding never deactivates the coach's promo codes → keeps earning/discounting forever | `lib/coachOffboard.ts:107` | Deactivate owned promo codes inside cascade | WP-6 |
| P0-9 | Video pipeline dead (the content_admin breakage) | `schema.ts:750` FK; `catalog/exercises/route.ts:61` regex; `videos/route.ts:98` untry/caught insert | Relax id regex to bundled slug space + seed `exercises` + wrap insert in try/catch with reservation rollback → 400 | WP-9 |
| P0-10 | Admin `/admin/meal-payments` nav link 404s (page never built) | `admin/layout.tsx:46`; no `admin/meal-payments/**` files | Build the page against the existing complete API | WP-11 |
| P0-11 | Partner subscription surface absent (no data layer, no route) | `partner/_data.ts` (no mealSubscriptions select); no `/api/partner/subscriptions` | Partner subscription data layer + route + roster page | WP-8 |
| P0-12 | Non-terminal one-time order that is no longer "today" is permanently invisible on every partner surface | `partner/_components/TodayBoard.tsx:72` | Include stuck one-time orders in an "overdue/needs-attention" lane | WP-7 (+WP-8 data) |
| P0-13 | Zero-permission staff bounced on login ("login did nothing") | `mobile staff/_layout.tsx:28`; `features/auth/nav.ts:34` | Gate on `staffRole && perms.length>0`; render hub empty-state | WP-12 |
| P0-14 | Web coach thread has no live delivery + GET-render mark-read side effect | `coach/threads/[userId]/page.tsx:26,66` | Pure render + client poll of `GET .../[userId]` + client `POST .../read` | WP-10 |
| P0-15 | Partner menu: duplicate item on retry; blank price saves a free live item; cross-currency corrupts revenue totals | `MenuManager.tsx:342,317`; `api/partner/meals/route.ts:32` | Sync `mealId` after create; require price; validate item currency vs account currency | WP-7 |

### P1 — major (operationally critical, in the wave)

| # | Defect | Evidence | WP |
|---|---|---|---|
| P1-1 | Coach edit-panel + tier-request approve/reject gated on `coach.assign` but API requires `coach.application.review` → 403-trap | `coaches/page.tsx:158`, `CoachDetail.tsx:257,446`; `api/admin/coaches/[id]/route.ts:32` | WP-2 |
| P1-2 | AssignClient 400 always shown as "not a coach"; staff accounts appear in the assign picker | `AssignClient.tsx:123,65` | WP-2 |
| P1-3 | Support composer/Resolve/Reopen/Assign always enabled → 403-trap if `support.thread.reply` stripped | `support/_components/SupportInbox.tsx:458` | WP-2 |
| P1-4 | Broadcast `truncated` flag dropped by client; no audience-size preview; wrong error copy | `broadcast/_components/BroadcastComposer.tsx:31,379,130` | WP-2 |
| P1-5 | Payout queue reachable only via `wallet.manage` (nav + page + tab), defeating the `payouts.review` scoped grant; tab always renders → 403 in reverse | `wallets/page.tsx:86`, `layout.tsx:56`, `WalletsManager.tsx:268` | WP-1(nav)+WP-3 |
| P1-6 | Payout decision doesn't `router.refresh()` → server-rendered balances/StatTiles go stale | `PayoutsQueue.tsx:138` | WP-3 |
| P1-7 | Member credential controls: not rank-locked, no suspend reason, no `force` assign, gate ignores overrides | `MemberDrawer.tsx:640,597,196,73`; `members/page.tsx:80` | WP-5 |
| P1-8 | `member_admin` can suspend a partner login via the generic Members drawer (partners.manage bypass) | `api/admin/members/[id]/route.ts:210` | WP-5 |
| P1-9 | Subscriptions save silently wipes `tierStartedAt` to null for search-path members | `SubscriptionsManager.tsx:86`; `lib/tier.ts:80`; stale-after-save `:226` | WP-5 |
| P1-10 | Analytics revenue omits the entire meal-delivery vertical (finance blind spot) | `admin/analytics/_components/data.ts:172,404` | WP-4 |
| P1-11 | Coach-applications mobile GET caps pending at 200 (C14 regression) | `api/admin/coach-applications/route.ts:61` | WP-4 |
| P1-12 | Web coach thread loads unbounded history every render (perf) | `coach/threads/[userId]/page.tsx` | WP-10 |
| P1-13 | Mobile "Change tier" not `statusLocked` (403-trap) | `staff/admin/members.tsx:743` | WP-12 |
| P1-14 | Mobile coach-revoke impact preview drops `pendingTierRequests`/`activeWorkoutPlans`/`activeDietPlans`; `doGrant()` has no impact check at all | `staff/admin/staff.tsx:48,191` | WP-12 |
| P1-15 | Mobile support never marks thread read → unread badges never clear | `staff/admin/support.tsx:215` | WP-12 |
| P1-16 | Mobile wallets never renders server `revoked` flag → can't tell offboarded coach apart | `staff/admin/wallets.tsx:384,502` | WP-12 |
| P1-17 | Mobile meal-payments refund error copy misleads (no `already_refunded`/`not_approved`/`non_refundable` cases) | `staff/admin/meal-payments.tsx:74`; `features/staff/api.ts:160` | WP-12 |
| P1-18 | Coach Flags UI never renders the `restore` action — the only path to un-flag a false-positive workout | `coach/flags/_components/FlagsList.tsx:253` | WP-10 |

### P2 — minor (representative; ~40 total across audits, triaged to Wave 2)

Content ready-flip fails closed on Cloudinary read-after-write 404 → stranded upload, web has no requeue (`videos/[id]/route.ts:118`) · catalog clearing an optional field is a silent no-op (`CatalogManager.tsx:191`) · gym create Status/Verified controls silently dropped (`GymsManager.tsx:494`, `api/admin/gyms/route.ts:123`) · gamification "Active challenges" counts all-time rows (`gamification/page.tsx:69,133`) · audit CSV export ignores active filters (`audit/page.tsx:97`) · partner earnings attributes full order total incl. platform-held digital money, no COD/digital split (`earnings/page.tsx:94`) · `effectiveTier()` ignores `tierStartedAt` so scheduled start is cosmetic (`packages/shared/.../entitlements.ts:89`) · member checkout hides delivery/small-order fee + grand total until after placement (`mobile meals/checkout.tsx:313`) · mobile audit action-filter chips stale vs real action strings (`staff/admin/audit.tsx:75`) · mobile "Custom foods" moderation tab is a permanent dead end (`staff/admin/content.tsx:68`) · retired `content.video.publish` key lingers in doc comments across 6 files (comment-only landmine during the ongoing migration).

---

## 6. Missing-Capabilities Roadmap

### NOW (ship this week — v1.0.2; = the §7 fix-wave)
- **Close the authz hole** (main_admin override floor) — a super_admin should not be able to lock a main_admin out of a surface.
- **Revive the video pipeline** — coaches/admins can attach a video to a real member exercise and it reaches members.
- **Un-trap money review** (coach edit, payout queue, member credentials, support composer) + **web refund confirmation** — operators can act on every account they're authorized for, and can't fat-finger an irreversible refund.
- **Restore the mobile admin console** (overview contract, list starvation, zero-perm login) — admins can use the phone app at all.
- **Build the admin meal-payments page + admin/partner subscription rosters** — finance can review meal money and ops can manage meal plans.
- **Live coach chat on web + flag-restore** — coaches stop seeing "messages not working."
- **Partner order/menu integrity** (stuck-order visibility, mark-refused, duplicate/price/currency guards) — restaurants don't lose orders or list free items.

### NEXT (this month — v1.0.3)
- **Mobile parity screens** for analytics, broadcast, gamification, catalog, moderation, partners, gyms, abuse, and a **per-account permission-override editor** — five admin permissions currently open a *barren* mobile console; two don't open it at all. *Justification: a phone-only admin today has zero path to half the platform's controls.*
- **Coach mobile queues** (attention/review/verify/flags/challenges) — *five of six coaching workflows are web-only.*
- **Member checkout fee preview / quote endpoint** — *members currently commit to an amount they never see.*
- **Partner earnings breakdown (COD vs platform-held digital) + admin partner-revenue visibility** — *precursor to any payout.*
- **Search / filter / pagination + filtered CSV export** across consoles that are documented as growing to thousands of rows.
- **Reporting-accuracy fixes** (analytics meal revenue, gamification active-count, catalog field-clear, gym publish-flag, audit filtered export).

### FUTURE (vision — one-line business justification)
- **Partner payout + commission/take-rate model** (mirror the coach wallet vertical) — *there is no way for a restaurant to be paid, and no platform cut is taken on meal orders today.*
- **Rider tracking + live order maps** — *close the fulfillment loop from kitchen to doorstep, the obvious next step for a delivery marketplace.*
- **Coach scheduling / calendar** — *convert async mentorship into booked sessions, a monetizable premium tier.*
- **Member cohorts + segmented broadcast (saved audiences, scheduling, deep-links)** — *turn the announce-only broadcast tool into a retention/growth engine.*
- **Multi-restaurant marketplace** (categories, discovery, ratings, multi-vendor cart) — *scale meal delivery beyond a hand-curated partner list.*
- **Analytics warehouse + configurable date ranges + churn metrics** — *the promised churn/cohort analytics that don't exist yet; unlock finance-grade reporting.*
- **In-thread attachments + read receipts (coach chat), video preview/playback + member video library browse** — *make the content and coaching products feel complete.*

---

## 7. FIX-WAVE PLAN (v1.0.2)

**Global rules for implementers.** File ownership below is **strictly disjoint** — no file appears in two packages. Where a package depends on another's output, the **frozen contract** is stated inline; do not deviate. **Land WP-1 first** (it changes `effectivePermissionSet`/`requirePartner`/nav gates that other packages' gate logic and partner routes rely on). One feature module per branch (CLAUDE.md). **Do NOT touch** anything in the meal-order customer/location area, partner `OrderDetailDrawer`, or admin order-detail — a concurrent workflow owns it. **Do NOT edit `schema.ts` deliveryLat/Lng** — another workflow just added it via `db:push`.

**Cross-package frozen contracts (authoritative):**
- **C-A** `effectivePermissionSet(account)` (WP-1): for `super_admin` **and** `main_admin`, returns the full role preset; DENY overrides may not remove a preset permission for these two roles. Return type unchanged (`Set<Permission>`). Consumed by WP-2/3/4/5/6/11 gate logic.
- **C-B** `requirePartner(req)` (WP-1): returns 403 unless the partner's effective set contains **both** `meals.own` and `orders.fulfill`. No signature change. Consumed by WP-7/WP-8 partner routes (behavior-compatible for normal partners).
- **C-C** Nav (WP-1, `admin/layout.tsx`): `/admin/wallets` visible when set has `wallet.manage` **OR** `payouts.review`; add `/admin/meal-subscriptions` gated on `payments.review`. Consumed by WP-3/WP-11.
- **C-D** `GET /api/admin/payment-requests` (WP-4) response shape becomes `{ rows: PaymentRequest[] /* unbounded-pending ++ capped-decided */, counts: { pending: number } }`. Consumed by WP-12 mobile schema.
- **C-E** `loadActiveOrders()` (WP-8, `partner/_data.ts`) now returns non-terminal one-time orders regardless of date and adds a boolean `isLate` per row; removes no existing field. Consumed by WP-7.
- **C-F** `offboardCoach()` dry-run (WP-6) response includes `pendingTierRequests`, `activeWorkoutPlans`, `activeDietPlans`; the cascade deactivates owned promo codes. Consumed by WP-12 mobile impact preview.
- **C-G** Canonical `exercises.id` = bundled free-exercise-db slug space; relaxed regex `^[A-Za-z0-9_-]+$` (WP-9). Consumed by WP-9's own videos route + seed.

---

**WP-1 — Authz & nav core** · model: **opus** (security)
Files: `apps/web/src/lib/authz.ts` · `apps/web/src/app/api/admin/staff/[accountId]/permissions/route.ts` · `apps/web/src/app/admin/layout.tsx`
Defects: **P0-1, P0-3**, P1-5 (nav half). Emits **C-A, C-B, C-C**.
Scope: floor main_admin in `effectivePermissionSet`; make the permissions route refuse to persist a preset-removing override against main_admin; add the effective-permission check to `requirePartner`; fix the `/admin/wallets` nav gate and add the `/admin/meal-subscriptions` item.

**WP-2 — Web console gate reconciliation (403-traps)** · model: **opus** (permission correctness)
Files: `apps/web/src/app/admin/coaches/page.tsx` · `.../coaches/_components/CoachDetail.tsx` · `.../coaches/_components/AssignClient.tsx` · `apps/web/src/app/admin/support/_components/SupportInbox.tsx` · `apps/web/src/app/admin/broadcast/_components/BroadcastComposer.tsx`
Defects: **P1-1, P1-2, P1-3, P1-4**.
Contract: `coaches/page.tsx` derives `canAssign` (`coach.assign`) and `canReview` (`coach.application.review`) from `effectivePermissionSet` and passes both; `CoachDetail` gates the Edit panel + tier-request buttons on `canReview`. `SupportInbox` disables composer/lifecycle buttons when the effective set lacks `support.thread.reply`. `BroadcastComposer` surfaces the `truncated` flag and fixes error copy.

**WP-3 — Wallets & payouts console** · model: **opus** (money)
Files: `apps/web/src/app/admin/wallets/page.tsx` · `.../wallets/_components/WalletsManager.tsx` · `.../wallets/_components/PayoutsQueue.tsx` · `apps/web/src/app/api/admin/wallets/[coachId]/entries/route.ts`
Defects: **P0-4**, P1-5 (page/tab half), **P1-6**; plus revoked-coach entry messaging + `idempotencyKey` on `recordEntry`.
Contract: page loads for `wallet.manage` **or** `payouts.review`; the "Payout requests" tab renders only when the set holds `payouts.review`; `PayoutsQueue` calls `router.refresh()` after any decision. Entries route resolves the coach by `coachProfiles`/historical ledger (per **C-A** guarantees main_admin isn't self-locked).

**WP-4 — Payments, refund safety, list routes & finance analytics** · model: **opus** (money)
Files: `apps/web/src/app/admin/payments/page.tsx` · `.../payments/_components/PaymentsQueue.tsx` · `apps/web/src/app/api/admin/payment-requests/route.ts` · `apps/web/src/app/api/admin/coach-applications/route.ts` · `apps/web/src/app/api/admin/payouts/route.ts` · `apps/web/src/app/admin/analytics/_components/data.ts`
Defects: **P0-5, P0-6**, P1-10, P1-11; plus All-tab global sort + member search. Emits **C-D**.
Scope: ConfirmDialog before web refund; unbounded-pending + per-status counts on the mobile-facing GET routes; global reverse-chron sort on the All tab; add `meal_payment_requests` (via `meal_orders`/`meal_billing_cycles`) into `loadRevenueByMonth`/`loadDeltas`.

**WP-5 — Members & subscriptions admin** · model: **opus** (security/data-integrity)
Files: `apps/web/src/app/admin/members/page.tsx` · `.../members/_components/MemberDrawer.tsx` · `apps/web/src/app/api/admin/members/[id]/route.ts` · `apps/web/src/app/admin/subscriptions/page.tsx` · `.../subscriptions/_components/SubscriptionsManager.tsx` · `apps/web/src/lib/tier.ts`
Defects: **P1-7, P1-8, P1-9**; plus wire the built "view-as" link and reuse the richer coach picker.
Contract: `MemberDrawer` receives the caller's effective `Set<Permission>` (not `callerRole`) and gates all sensitive controls + rank-lock on it, collects a suspend reason, and sends `force` on capacity-blocked assign. `members/[id]` route rejects suspend/tier when target role is `partner`. `setAccountTier`: `startsAt: undefined` leaves `tierStartedAt` untouched (only an explicit clear sentinel nulls it); `SubscriptionsManager` re-runs its search fetch after save.

**WP-6 — Staff & roles + coach offboarding cascade** · model: **opus** (security)
Files: `apps/web/src/app/admin/staff/page.tsx` · `.../staff/_components/StaffManager.tsx` · `apps/web/src/lib/coachOffboard.ts`
Defects: **P0-7, P0-8**; plus exclude/lock partner rows from the staff roster; surface `pendingTierRequests` in the impact gate. Emits **C-F**.
Contract: both the row dropdown and the Grant-role modal call one shared offboard-impact preview before any role change away from `coach`, requiring typed CONFIRM when impact exists. `offboardCoach()` deactivates owned promo codes and returns the full six-field impact count.

**WP-7 — Partner portal UI + menu integrity** · model: **opus** (logic; money-adjacent)
Files: `apps/web/src/app/partner/_components/TodayBoard.tsx` · `.../_components/OrdersQueue.tsx` · `.../_components/PartnerDashboardOverview.tsx` · `.../_components/MenuManager.tsx` · `apps/web/src/app/api/partner/meals/route.ts`
Defects: **P0-12, P0-15**; plus poll-error handling + OrdersQueue late-highlight + dashboard-count consistency. Consumes **C-E**.
Scope: render an "overdue/needs-attention" lane fed by non-today one-time orders; add a "Mark refused" action to `TodayBoard.nextAction()` (board button — **not** the excluded OrderDetailDrawer); `MenuManager.save()` syncs `mealId` after a successful create so retry can't duplicate; require a numeric price; server rejects a meal currency ≠ the partner's account currency.

**WP-8 — Partner data layer + subscription roster** · model: **opus** (logic)
Files: `apps/web/src/app/partner/_data.ts` · `apps/web/src/app/partner/subscriptions/page.tsx` · `apps/web/src/app/api/partner/subscriptions/route.ts` *(new)*
Defects: **P0-11**; delivers the partner half of reported breakage #3. Emits **C-E** and the roster projection contract.
Scope: add partner-scoped selects over `mealSubscriptions`/`mealSubSkips`/`mealBillingCycles`; a masked-contact subscriber roster (schedule days×window, plan type, price, start date, active/paused/cancelled, this-week cycle status); a read-only multi-week forecast derived from `daysOfWeek`/`startDate` **without** touching the `materialize.ts` spawn horizon. Fix `loadActiveOrders` per **C-E**.

**WP-9 — Video pipeline repair** · model: **opus** (data/FK correctness)
Files: `apps/web/src/app/api/admin/videos/route.ts` · `apps/web/src/app/api/admin/catalog/exercises/route.ts` · `packages/db/src/seed/exercises.ts` *(new)* + its `packages/db` script entry
Defects: **P0-9**; the content_admin breakage. Emits **C-G**.
Scope: relax the create-exercise `id` regex to `^[A-Za-z0-9_-]+$`; seed/upsert the bundled free-exercise-db catalog into `exercises` so FKs resolve; wrap the `plan_videos` insert in try/catch that deletes the reserved host upload and returns `400 invalid_exercise` on FK violation. (Web UploadModal picker + planId/standalone member read-path are NEXT.)

**WP-10 — Coach messaging live delivery** · model: **opus** (logic)
Files: `apps/web/src/app/coach/threads/[userId]/page.tsx` · `apps/web/src/app/coach/_components/MessageList.tsx` · `apps/web/src/app/coach/_components/ReplyBox.tsx` · `apps/web/src/app/coach/flags/_components/FlagsList.tsx` · `apps/mobile/src/features/coach/useCoachThread.ts`
Defects: **P0-14**, P1-12, **P1-18**; plus the false "typing" bubble.
Scope: make the thread page a **pure render** (delete the RSC `db.update` mark-read); `MessageList` polls `GET /api/coach/threads/[userId]` (~10s) and calls the existing `POST .../read` client-side; cap/paginate history; render the `restore` action in `FlagsList`; suppress the "typing" bubble in `useCoachThread` when the member has an assigned human coach. No API contract change (mobile parity preserved).

**WP-11 — Admin meal-payments + meal-subscriptions surface** · model: **sonnet** (assembly over existing API)
Files: `apps/web/src/app/admin/meal-payments/page.tsx` *(new)* + `.../meal-payments/_components/*` *(new)* · `apps/web/src/app/admin/meal-subscriptions/page.tsx` *(new)* + `.../_components/*` *(new)* · `apps/web/src/app/api/admin/meal-subscriptions/route.ts` *(new)* · `apps/web/src/app/api/admin/exports/meal-payment-requests/route.ts` *(new)*
Defects: **P0-10**; admin half of reported breakage #3.
Scope: mirror the complete mobile meal-payments screen to web against the existing `GET/POST /api/admin/meal-payments/**` (no API change); build an admin meal-subscription roster (read `mealSubscriptions`/`mealBillingCycles`) with pause/cancel via a **new admin-authed** route (do not reuse the member-authed `/api/meals/subscriptions/[id]`); add the CSV export. Consumes **C-C** nav item. **Must not** touch admin order-detail.

**WP-12 — Mobile staff console remediation** · model: **sonnet** (mechanical; opus-review the auth-gating sub-part)
Files: `apps/mobile/src/features/staff/api.ts` · `apps/mobile/src/features/staff/nav.ts` · `apps/mobile/src/app/staff/_layout.tsx` · `apps/mobile/src/features/auth/nav.ts` · `apps/mobile/src/app/staff/admin/index.tsx` · `.../staff/admin/members.tsx` · `.../staff/admin/staff.tsx` · `.../staff/admin/support.tsx` · `.../staff/admin/wallets.tsx` · `.../staff/admin/meal-payments.tsx` · `.../staff/admin/audit.tsx`
Defects: **P0-2, P0-13**, P1-13, P1-14, P1-15, P1-16, P1-17; plus stale audit filter chips + `assignClient` `force`. Consumes **C-D, C-F**.
Scope: nested `adminOverviewSchema`; gate post-login redirect + staff-layout on `staffRole && perms.length>0`; add `partners.manage`/`gyms.manage` to the console OR-gate and remove `client.tier_grant` from the coach OR-gate (or route it to a valid screen); `statusLock` the mobile change-tier action; render the full coach-revoke impact + add an impact check to `doGrant()`; call `markAdminSupportThreadRead` after loading a thread; render the `revoked` badge + disable the entry form for revoked coaches; map `non_refundable`/`already_refunded`/`not_approved` refund copy.

### Deferred P1s (Wave 2 / v1.0.3 — owners pre-assigned, not in the v1.0.2 ship)
These are real P1/P2 correctness bugs consciously sequenced after the ship-blockers; each has a clean single-owner file for a follow-on wave: content ready-flip requeue (`videos/[id]/route.ts`), catalog field-clear (`CatalogManager.tsx`), gym publish-flag drop (`GymsManager.tsx` + `api/admin/gyms/route.ts`), gamification active-count (`gamification/page.tsx`), audit filtered CSV (`audit/page.tsx` + `exports/audit/route.ts`), partner earnings breakdown (`partner/earnings/page.tsx`), member checkout fee preview (needs a new `/api/meals/quote` endpoint).

---

## 8. Quality Gates & Release Plan (v1.0.2)

### Gates (must pass before each package lands)
1. `pnpm --filter web typecheck` → **0 errors** (baseline is clean today).
2. `pnpm --filter mobile exec tsc --noEmit` → **0 errors** (the real mobile gate per MEMORY; **do not** gate on `expo lint` — it's react-compiler-strict and noisy on existing code).
3. `node --test` in `packages/shared` → **430/430** green (extend with an admin-overview + payment-requests schema round-trip test asserting mobile zod parses the live route shape — this is the class of bug that shipped).
4. `pnpm db:push` applied to Neon for WP-9's `exercises` seed. **Coordinate with the concurrent deliveryLat/Lng workflow** — confirm that push has landed before member order-create smoke, since both share `db:push` (no migration files) and a lagging DB fails inserts silently.
5. **Permission-matrix smoke** (manual/scripted): for each 403-trap fixed (WP-1/2/3/5), exercise the surface as (a) super_admin, (b) main_admin with a DENY override, (c) a sub-role with the exact single permission the surface needs, and (d) the same sub-role with it stripped — assert no dead button and no click-then-403.
6. **Breakage regression checks:** attach a video to a real member exercise end-to-end (WP-9); open a coach thread and confirm an inbound member message appears without reload (WP-10); load `/admin/meal-payments` (WP-11); load the partner subscription roster (WP-8); sign in as a zero-permission staff account and confirm the mobile hub empty-state (WP-12).

### Release sequencing
- **Branch order:** WP-1 → (WP-2, WP-3, WP-4, WP-5, WP-6 in parallel) → (WP-7 depends on WP-8's **C-E**; WP-8 first, then WP-7) → (WP-9, WP-10, WP-11 independent) → WP-12 (depends on **C-D** from WP-4 and **C-F** from WP-6, so land last).
- One feature module per branch, conventional commits (`fix:`/`feat:`), co-authored trailer per repo convention.
- Bump `VERSION` → **1.0.2**, CHANGELOG grouped by the three reported breakages + "authz hardening" + "money-review safety" + "mobile console restoration."
- **Post-ship canary:** watch for `StaffApiError` parse failures on `/api/admin/overview` and `/api/admin/payment-requests` (the drift signals), and for FK-violation 500s on `POST /api/admin/videos` (confirms WP-9's rollback path holds).

**Owner-facing bottom line:** v1.0.2 is a *console-and-contract* release, not a rewrite. Twelve disjoint packages retire every P0 and the operationally-critical P1s — including all three reported breakages — without touching the sound money/data core. The largest residual exposure after v1.0.2 is **mobile admin/coach parity** (roughly nine web-only surfaces), which is the headline of the NEXT wave.

---
*Relevant absolute paths for the implementation team are enumerated per package in §7. Root-cause chains in §4 were re-verified against `E:\GYM Tracker` source, not just the audit reports.*