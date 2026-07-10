# Coach–Trainee Mentorship System

Design + implementation record (2026-07-10). Builds on the existing staff/coach
spine (`coachAssignments`, `coachMessages`, `authz.ts` permission matrix,
check-ins, badge verification) — nothing existing was duplicated.

## 1. Roles & routing (already existed, now completed)

- **Role source of truth:** a row in `admins` (`role='coach'`) makes an account
  a coach; permissions come from the hardcoded matrix in
  `apps/web/src/lib/authz.ts` (`coach.user.read`, `coach.message.user`, …).
  Members have no `admins` row.
- **Mobile routing:** members live in `(tabs)`; coaches additionally get the
  staff console at `/staff/coach/*` (gated by `GET /api/me/staff`). A coach IS
  also a member — the console is an extra surface, not a separate login.
- **Ownership rule:** every coach action on a member goes through
  `requireCoachOwnsUser` (active `coachAssignments` row). Requests are the only
  coach surface that sees non-clients, and only rows addressed to that coach.

## 2. Data model (packages/db/src/schema.ts)

```
coach_profiles (extended)          coach_requests (new)
─ account_id PK → accounts         ─ id PK
─ display_name, bio, avatar_url    ─ user_id → accounts
─ headline                         ─ coach_id → accounts
─ specialties jsonb string[]       ─ status pending|accepted|declined|canceled
─ certifications jsonb             ─ message (PII-masked intro)
    [{title, issuer, year|null}]   ─ decided_at, created_at
─ achievements jsonb string[]      ─ idx (user,created), (coach,status)
─ years_experience int
─ capacity int (default 50)        coach_milestones (new)
─ accepting_clients bool           ─ id PK
─ reply_window_hours int           ─ coach_id → accounts
─ is_active bool                   ─ account_id → accounts (the trainee)
                                   ─ title, note (PII-masked)
coach_assignments (existing)       ─ achieved_at date
─ unique (coach,user), status      ─ idx (account,achieved_at), (coach)
  active|ended, assigned_by
```

Invariants:
- One **pending request per member** (route-enforced) — a member shops one
  coach at a time.
- One **active coach per member** in member-facing UX: accepting a request
  ends the member's other active assignments.
- Specialties come from the shared `COACH_SPECIALTIES` catalog
  (`packages/shared/src/logic/mentorship.ts`) so discovery filters stay
  meaningful.

Migrations: additive columns/tables — apply with `pnpm db:push` (repo has no
migration files by design).

## 3. API surface

Member (Bearer):
| Route | Purpose |
|---|---|
| `GET /api/coaches` | Discovery list (name, headline, specialties, years, accepting, load) — never exposes emails |
| `GET /api/coaches/[id]` | Full portfolio (bio, certifications, achievements, reply window) |
| `GET /api/me/coach` | Resolved current coach + own pending request (drives chat header/home card) |
| `POST /api/coach-requests` | Send request `{coachId, message?}` — 409 `already_pending` / `already_assigned` / `not_accepting`, 404, staff-caller 403; 5/hour rate limit |
| `GET /api/coach-requests` | Own request history |
| `DELETE /api/coach-requests/[id]` | Cancel own pending |
| `GET /api/me/milestones` | Coach-built portfolio timeline |

Coach console (staff perms):
| Route | Purpose |
|---|---|
| `GET /api/coach/requests` | Pending requests addressed to me |
| `POST /api/coach/requests/[id]` | `{action:'accept'\|'decline'}` — accept re-checks capacity (409 `full`), upserts assignment, ends member's other assignments, audits, pushes |
| `DELETE /api/coach/users/[userId]` | End coaching (own client only) |
| `GET/POST /api/coach/clients/[userId]/milestones` | Read/log client milestones |
| `DELETE /api/coach/milestones/[id]` | Remove own milestone |
| `GET/PATCH /api/coach/profile` | Extended with portfolio fields |

## 4. Privacy: PII stays in-app

`maskPii()` (`packages/shared/src/logic/mentorship.ts`, unit-tested) masks
emails, 7+-digit phone runs, and `@handles` with
`[hidden — keep chat in the app]`. Applied **server-side before storage** on:
member chat sends, coach replies, check-in replies, request intros, milestone
text. Leaked contact details never reach the database; no client can opt out.
Gym numbers (weights `102.5`, sets `5x5`, kcal, years) survive — the phone
pattern requires 7+ digits.

Chat access: previously Elite-entitlement only. Now **an active coach
assignment also unlocks the thread** (server + mobile), so an accepted trainee
can always talk to their coach; the AI auto-reply stays suppressed when a
human coach owns the thread.

## 5. Core screens (mobile)

**Coach Discovery Hub — `/coaches`**
Back pill → header (eyebrow "Find your coach" / big "COACHES") → pending-request
banner (when one exists) → coach cards: avatar block · name · one-line headline
· up to 3 specialty chips · "Accepting"/"Full" tag. Charcoal rows, 12dp gaps.

**Coach profile — `/coaches/[id]`**
Red hero block (the screen's single red block): avatar, uppercase name,
headline, black-ink stat pills (years · clients · reply window). Below:
specialty chips → Certifications (rows: title / issuer · year) → Achievements
(bullets) → bio. Bottom CTA state machine: *Request coaching* (opens intro
sheet, ≤500 chars) / *Cancel request* / *Your coach → Open chat* / disabled
"Not taking clients".

**Member chat — `/coach-chat`** (existing screen, made identity-aware)
Header shows the real coach's name from `/api/me/coach`; unlocked for assigned
members regardless of tier; locked state now offers "Browse coaches".

**Portfolio — Progress tab**
"Coach milestones" section: ribbon rows (title / note / date / coach name).
Coach-verified badges (existing verification flow) + milestones together form
the trainee's coach-built portfolio.

**Coach console — `/staff/coach`**
Requests section above the roster (accept/decline per row, capacity error
inline) → roster as before. Profile editor gains headline, specialties
(chip toggles), certifications & achievements list editors, years, capacity.
Client screen gains Milestones (list + log form) and an End-coaching action.

## 6. Matching flow

```
member: browse /coaches → open profile → Request coaching (+intro)
   └ server: one pending max, capacity+accepting checked, push → coach
coach: console Requests → Accept
   └ server: capacity re-check → assignment upsert (active)
             → member's other active assignments ended
             → request accepted + audit + push → member
member: home card + chat header now show the coach; chat unlocked
either side can end: coach console (End coaching) / admin console (existing)
```

Elite auto-assign (`lib/coachAutoAssign.ts`) is unchanged and coexists: it
fills a coach for Elite members who never picked one.

## 7. Notifications

Existing FCM plumbing (`lib/push.ts`, fire-and-forget in `after()`):
`coach_request` → coach, `coach_request_decided` → member,
`milestone_logged` → member — alongside the existing `coach_message`,
`checkin_reply`, `badge_verified`, `suggestion_reviewed`.

## 8. Deliberately out of scope (v1)

Ratings/reviews, payments for coaching tiers (BILLING_MODE owns money),
media portfolios (transformation photos — needs private-bucket work),
multi-coach rosters per member, coach search/filter UI (catalog chips make it
cheap to add), websocket real-time (polling + push notifications match the
app's existing offline-first messaging model).
