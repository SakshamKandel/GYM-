# What this folder is, and how to get a database

`_journal.json` and the `*_snapshot.json` files are drizzle-kit's bookkeeping.
Read this before you trust the folder above it. (The leading underscore in the
filename is load-bearing: drizzle-kit treats every file in `meta/` that does not
start with `_` as a snapshot and tries to parse it as JSON. Do not rename this.)

## There is no 0000 migration, and that is not an oversight

This project has always applied schema changes with `drizzle-kit push`, so the
generated migration history drifted out of step with the real database. On
2026-07-25 the history was reset: `0000_snapshot.json` was introspected straight
from the live database, which makes it accurate by construction — but an
introspected baseline has no runnable SQL behind it, because drizzle writes the
introspect dump out entirely commented (`-- If you want to run this migration
please uncomment this code`).

The journal used to list a `0000_…` entry whose `.sql` file was never committed,
so anything that walks the journal — `drizzle-kit migrate` above all — died on
the first file read. The journal now starts at `0001_live_delta`, the first
migration generated against the baseline, and every entry it lists is a file you
can actually open. The `0000_snapshot.json` baseline stays here because it is
what `0001` was diffed against.

## Getting a working database from scratch

Do not try to replay this folder. It starts from a baseline it cannot recreate,
so a fresh database is built from the schema instead:

```
cp .env.example .env                  # then put your own DATABASE_URL in it
pnpm --filter @gym/db db:push         # builds the schema from src/schema.ts
pnpm --filter @gym/db check:constraints
```

`src/schema.ts` is the source of truth, so an empty database comes out matching
what the app expects. `check:constraints` then confirms the partial uniques and
check constraints landed.

## Changing the schema

1. Edit `packages/db/src/schema.ts`.
2. `pnpm --filter @gym/db db:push` against your own database.
3. For the shared database, `pnpm --filter @gym/db db:generate` writes the next
   numbered migration next to `0001_live_delta.sql`, and
   `pnpm --filter @gym/db apply:migration -- migrations/0002_….sql` applies one
   reviewed file inside a single transaction, refusing anything destructive.

`../legacy/` holds the pre-baseline files. They are history only — do not run
them.
