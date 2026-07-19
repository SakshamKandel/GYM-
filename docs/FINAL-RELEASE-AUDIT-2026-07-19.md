# Final release audit — 2026-07-19

## Executive result

The product is feature-rich and substantially beyond the original MVP, but the
audit found several release-critical integrity and privacy gaps hidden beneath
otherwise complete-looking screens. This pass therefore prioritizes account
isolation, authorization, order/payment correctness, deletion privacy, and
professional customer/staff journeys before additional cosmetic expansion.

The audit covered:

- more than 75 Expo Router mobile routes;
- the public website and password-reset flow;
- 25 admin pages and their permission gates;
- 12 coach pages and their API loaders;
- 9 partner pages, menu/store controls, fulfilment, subscriptions, and revenue;
- 77 admin, 32 coach, 9 partner, and all member-facing meal API routes;
- local SQLite persistence, auth hydration, account switching, and sync retry
  behaviour;
- representative desktop and 390×844 mobile-browser rendering of the new public
  website.

This document is the implementation plan and release ledger. A checked item is
implemented in the current audit branch; an unchecked item remains a real
release dependency rather than an implied feature.

## Release gates

### P0 — must be correct before a public production release

- [x] Scope all on-device health and activity data to an immutable account owner.
- [x] Prevent a prior account's pending workout queue from being displayed,
  uploaded, or falsely marked synced after an account switch.
- [x] Enforce coach page permission overrides on the server before page loaders
  execute, including explicit per-account denies.
- [x] Enforce partner delivery coverage at quote, one-time-order, and recurring
  subscription creation.
- [x] Protect one-time meal retries with an account-scoped idempotency key and
  canonical request fingerprint.
- [x] Create a one-time order, line items, and initial event in one database
  transaction.
- [x] Prevent partner deactivation when live orders exist and lock a partner's
  currency after menu or financial history exists.
- [x] Delete the provider asset when a member deletes a private progress photo.
- [~] Harden full account deletion: explicit confirmation, legacy-data cleanup,
  private-asset cleanup, active-service preflight, and defensible retention of
  transaction records. Implementation is in progress in this audit pass.
- [~] Close paid cancellation/skip/refusal paths so payment can never be retained
  without a refund or an explicit review workflow. Implementation is in progress.
- [ ] Replace subscription preview grants with real RevenueCat purchases and
  restore-purchase handling. This is blocked on Apple/Google store accounts,
  product identifiers, and public SDK keys.
- [ ] Add Sign in with Apple for the iOS build. This is blocked on the Apple
  developer capability/service configuration and final identity-linking policy.
- [ ] Complete the general offline mutation queue beyond workouts. Repository
  ownership is now safe, but nutrition/body/settings writes still need durable
  device-to-API replay and conflict tests.

### P1 — required for a professional operational launch

- [x] Replace the API-only root page with a responsive, accessible GM Method
  website: home, plans, privacy, terms, contact, password reset, manifest,
  sitemap, robots, 404, and recoverable error state.
- [x] Add security headers and explicit no-store API responses.
- [x] Add server-side no-index metadata to admin, coach, and partner consoles.
- [x] Replace duplicated bare staff login forms with one responsive, accessible,
  role-specific admin/coach/partner sign-in surface.
- [x] Add partner currency-history and live-order impact summaries to the admin UI.
- [x] Preserve independently sold-out menu items across global store
  pause/resume by using a partner-level accepting-orders switch.
- [ ] Make order status mutation and its append-only event inseparable in the
  database; the current event append is best-effort after the status CAS.
- [ ] Make manual payment approval/refund transitions fully transactional under
  concurrent staff actions.
- [ ] Add member-visible refund/cancellation state, reason, owner, timestamps, and
  escalation context to meal order detail.
- [ ] Add recurring-plan editing for meal/menu/address/delivery-day changes with
  price re-quote and cutoff enforcement.
- [ ] Add dietary/allergen declarations and partner substitution approval before
  an unavailable meal is silently replaced or skipped.
- [ ] Finish progress-photo capture/upload UX on mobile; the secure API and asset
  lifecycle exist but the member journey is incomplete.
- [ ] Preserve all active-plan and coach-assigned workout metadata when hydrating
  a session into the logger.
- [x] Remove the unencrypted MMKV fallback for bearer/session secrets; when the
  platform keychain/keystore is unavailable, native persistence fails closed to
  process memory.
- [ ] Complete an accessibility sweep for icon-only controls, 48 dp targets,
  16 px body text, screen-reader labels, focus order, and low-contrast secondary
  text. The current lint-clean changes address errors, not every warning or
  manual screen-reader case.
- [ ] Add route-level tests for the most financially sensitive APIs instead of
  relying only on pure policy helpers.

### P2 — post-launch completeness

- [ ] Add a first-class member Buddy surface on mobile; backend buddy sessions,
  visibility, links, and DMs exist but discovery and daily use are fragmented.
- [ ] Add progress/share cards and complete the push-engagement plan.
- [ ] Add customer/partner communications tied directly to an order or refund.
- [ ] Replace capped operational queues with cursor pagination and authoritative
  counts everywhere.
- [ ] Remove remaining cross-feature imports by moving shared contracts to
  `packages/shared` or `lib` boundaries.
- [ ] Add an explicit, user-confirmed recovery/import flow for ownerless legacy
  device data. The secure default is quarantine because its owner cannot be
  inferred safely.

## Journey audit

| Journey | Current result | Important finding or action |
| --- | --- | --- |
| First launch → onboarding → targets | Complete | Eleven-step wizard and target computation exist; permission prompts are deferred appropriately. |
| Email/Google sign-in → hydration | Complete with hardening | Startup frames are branded. Local repository context now changes before signed-in state is published. |
| Account switch/sign-out | Hardened | Previous account rows are inaccessible by namespace and are not uploaded by the new account. |
| Select plan → Gym Mode → sets/rest/PR | Complete | Core logger, rest timer, plates, anatomy, and PR detection are present and tested. |
| Body weight/measurements | Mostly complete | EWMA trend works; mobile progress-photo capture remains missing. |
| Food search/barcode/custom food/water | Complete for direct use | General durable sync/replay is still missing outside workouts. |
| Meal partner → menu → cart → quote → checkout | Hardened | Delivery coverage parity, transactional creation, and retry idempotency are added. |
| Meal order → receipt → fulfilment → history | Strong but not final | Timeline/detail UI exists; paid cancellation/refund safety and atomic event persistence are release gates. |
| Recurring meal plan → bill → skip/pause/cancel | Partial | Basic lifecycle exists; plan editing and paid skip/cancellation economics need completion. |
| Gym discovery → gym detail | Actively upgraded | Responsive cards, gallery, hours, amenities, and actions are under concurrent UI work and preserved by this pass. |
| Membership/paywall | Prototype backend-ready | Tier catalog and entitlement checks exist; actual store purchase/restore is externally blocked. |
| Support/coaching/check-ins | Complete baseline | Human support inbox and coach tools exist; coach SSR permission bypass is fixed. |
| Delete account/export data | Being hardened | Local purge now works; server retention/deletion and broader account export need explicit completion. |
| Partner fulfilment/menu/store/revenue | Strong with safeguards | Live-order deactivation and currency-history corruption paths are blocked. |
| Admin members/payments/orders/partners/support | Broad and usable | Financial concurrency, queue pagination, and reason/communication detail remain the main operational gaps. |

## Implemented architecture changes in this audit

### Device data ownership

Every local repository operation runs inside an explicit owner namespace:
`account:<id>` for an authenticated member and `anonymous:<uuid>` for a guest.
SQLite v1 data with no provable owner moves atomically to
`legacy-quarantine:v1`; it is neither rendered nor uploaded. Web/QA memory
storage follows the same policy. Server-confirmed deletion physically purges
that account namespace.

### Meal commerce integrity

Delivery eligibility now has one deterministic policy shared by quote and
creation. Valid coordinates and a bounded radius are authoritative; normalized
service areas are a fallback only when geodata is incomplete. Unverifiable
addresses fail closed.

One-time order retries carry a UUID request id and canonical payload fingerprint.
The database enforces an account-scoped unique key for one-time orders. The
order, its line items, and its initial event are committed together; an exact
retry replays the existing order while a changed payload returns a conflict.

Partner currency changes are rejected after any menu or financial history.
Partner deactivation is rejected with an exact live-order breakdown. Both
deactivation and order creation use the same transaction-scoped partner lock so
the create/deactivate race cannot strand a newly committed order.

### Staff authorization

Coach server components now resolve the signed staff session and effective
allow/deny overrides before any protected loader runs. Navigation is derived
from the same effective permission set, while API routes remain the final
authorization boundary.

### Private image lifecycle

Image operations always select Cloudinary independently of the configured video
provider. Private progress-photo deletion destroys the authenticated Cloudinary
asset before removing its database reference. Missing assets are an idempotent
success; provider failures are visible and do not silently orphan a new row.

### Public web and recovery

The public site now explains the product and support paths without exposing an
API banner. Legal and reset-password routes exist at the links already emitted
by the backend. Marketing pages are responsive, keyboard reachable, and use the
same GM visual system. Console trees are no-indexed and sensitive JSON responses
are explicitly non-cacheable.

## Verification ledger

Completed during the audit:

- mobile ownership tests: 4/4;
- canonical mobile TypeScript check;
- mobile lint: zero errors (existing warnings remain documented);
- web policy tests: 28/28 before the final deletion/cancellation suites;
- web TypeScript checks after each independent backend slice;
- responsive browser verification of home, plans, and password-reset validation;
- `git diff --check` on completed independent slices.

Required final gate after all concurrent work settles:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The database migration in this branch must be reviewed and applied through the
normal deployment pipeline; this audit does not push schema changes directly to
production.

## External inputs still required

The following cannot be truthfully completed in source code alone:

1. Apple developer team, Sign in with Apple capability, service identifier, and
   account-linking decision.
2. App Store Connect and Google Play subscription products plus RevenueCat
   project/public SDK keys and entitlement mapping.
3. Final legal entity name, registered address, support contact, governing-law
   jurisdiction, and country-specific refund language for the legal pages.
4. Production monitoring/error-reporting destination and data-processing terms.

These are release inputs, not reasons to bypass or fake the integrations.
