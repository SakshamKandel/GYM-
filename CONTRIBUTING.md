# Contributing to GYM Tracker

Thanks for your interest in contributing! This document keeps the repository consistent and easy to maintain.

## Before your first change

- Read [CLAUDE.md](CLAUDE.md). It holds the hard rules, and they are not optional.
- Get a database up. Most of the app does nothing without one: the bootstrap chain is [docs/DEPLOY.md §0](docs/DEPLOY.md).
- [PROJECT_PLAN.md](PROJECT_PLAN.md) is the original 2026-07-03 plan, kept for history. Do not build from it.

## Workflow

1. Create a branch from `main`:
   - `feat/<short-name>` — new features
   - `fix/<short-name>` — bug fixes
   - `chore/<short-name>` — tooling, docs, maintenance
2. Keep changes small and focused — one concern per pull request.
3. Open a pull request against `main` with a clear description of **what** changed and **why**.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add rest timer between sets
fix: correct 1RM calculation for kg units
chore: update dependencies
docs: expand setup instructions
```

## Code Style

- TypeScript strict everywhere. No `any`. Shared types live in `packages/shared` only.
- Business logic belongs in a feature's `logic.ts` or in `packages/shared`, not inside UI components. Screens stay thin.
- Validate every payload crossing the network boundary with zod.
- Feature modules are isolated: `features/X` never imports from `features/Y`.

## Before you push

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three across every workspace. Adding a test is expected for PR detection, weight trend smoothing, macro math, sync-queue conflict handling and entitlement checks; those are where the bugs live.

## Reporting Issues

Open a GitHub issue with steps to reproduce, expected behavior, and actual behavior. Screenshots help.
