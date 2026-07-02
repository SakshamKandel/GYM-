# Contributing to GYM Tracker

Thanks for your interest in contributing! This document keeps the repository consistent and easy to maintain.

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

- TypeScript everywhere; avoid `any`.
- Business logic belongs in hooks/services, not inside UI components.
- Run lint and tests locally before pushing.

## Reporting Issues

Open a GitHub issue with steps to reproduce, expected behavior, and actual behavior. Screenshots help.
