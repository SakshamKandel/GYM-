# Account deletion and retained records

Last audited: 2026-07-19

`DELETE /api/me` is a fail-closed, self-service hard-delete endpoint. It requires
the JSON body `{ "confirmation": "DELETE" }`; the mobile type-to-confirm field
is therefore enforced at the network boundary and is not only a visual gate.

Before deleting anything, the endpoint returns HTTP 409
`account_deletion_blocked` with a typed `impact` object when the account has:

- a non-terminal meal order, non-cancelled meal subscription, or pending meal
  or membership payment review;
- staff, meal-partner, or coach offboarding dependencies;
- more than one legacy `profiles` row matching the account email; or
- retained order, subscription, payment, promo, discount, payout, or wallet
  history.

## Current retained-history limitation

Commerce and financial tables currently hold non-null foreign keys to
`accounts.id`, several with `ON DELETE CASCADE`. Hard-deleting an account with
that history would silently destroy business/audit records. Keeping the current
`accounts` row as an improvised tombstone is also unsafe: identity, entitlement,
support, delivery, and other PII-bearing relations were not designed around a
deleted-subject state.

For that reason, self-service deletion is deliberately blocked when retained
history exists. Support must first verify the requester and perform the
applicable offboarding/anonymization process. A future migration should add a
dedicated deleted-subject/tombstone model (or nullable anonymized ownership) and
explicit retention periods before this blocker is relaxed. No database migration
or production schema push is part of the 2026-07-19 hardening slice.

The admin `POST /api/admin/members/[id]/gdpr` route now uses the same impact
loader and private/legacy cleanup policy. It preserves its stricter permission,
rank, cannot-target-self, and typed-email gates, but it is a hard-delete route —
not the future retained-record anonymization process — and therefore returns the
same 409 instead of bypassing retention safeguards.

## Data cleanup for eligible accounts

- The one unambiguous legacy `profiles.email` match is deleted in the same
  atomic batch, cascading legacy workout, weight, measurement, food, water,
  target, streak, and buddy data. Custom-food creator attribution is detached
  first because that legacy foreign key is not cascading.
- Authenticated Cloudinary progress-photo assets are destroyed before their DB
  rows. Every asset is attempted, missing assets are successful no-ops, and DB
  deletion does not begin if any provider call fails. Retrying the full request
  is therefore safe even after only some assets were removed.
- The deletion audit records typed confirmation without copying the member
  email. Existing audit rows keep their action and timestamp for operational
  integrity, while account-linked target identifiers, metadata, and IP
  addresses are scrubbed before the account row is removed.

The old `photos.storage_path` field belongs to the pre-account legacy storage
model and does not identify a supported Cloudinary UID. Its database row is
removed by the legacy-profile cascade, but physical-object deletion cannot be
proven until that retired storage provider/bucket is identified. This is a
known legacy-storage follow-up, not silently reported as a verified asset purge.
