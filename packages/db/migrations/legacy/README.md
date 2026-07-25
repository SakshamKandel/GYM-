# Legacy migrations (pre-baseline)

These files predate the 2026-07-25 baseline reset and are kept for history only.
Do not run them.

Why the reset happened: this project has always applied schema changes with
`drizzle-kit push`, so the snapshot in `meta/` drifted badly out of step with the
real database. `drizzle-kit generate` could no longer produce a diff against it,
and emitted a full CREATE-everything dump instead.

The current baseline (`meta/0000_snapshot.json`) was introspected directly from
the live database, so it is accurate by construction. `0001_live_delta.sql` is
the first migration generated against it, and it is the one that finally created
the six `member_*` sync tables, the Apple auth tables, the payee settings and the
gym enquiries table, none of which had ever reached the database.
