# 🏋️ GYM Tracker

A modern workout and fitness tracking application — log workouts, track progress, and stay consistent.

> **Status: 🚧 Early development.** This repository currently contains the project foundation. Application code is landing soon.

---

## ✨ Planned Features

- **Workout logging** — exercises, sets, reps, and weight with a fast, friction-free UI
- **Progress tracking** — charts for strength gains, body weight, and personal records
- **Routine builder** — create and reuse workout templates (Push/Pull/Legs, Upper/Lower, custom splits)
- **Rest timer** — automatic rest countdowns between sets
- **History & streaks** — calendar view of completed sessions to keep you consistent
- **Offline-first** — log workouts at the gym without a connection, sync later

## 🧱 Proposed Architecture

The project is structured for scalability from day one:

```
gym-tracker/
├── src/
│   ├── app/            # Routes / screens
│   ├── components/     # Reusable UI components
│   ├── features/       # Feature modules (workouts, exercises, progress)
│   │   └── <feature>/  # Each feature owns its components, hooks, and logic
│   ├── lib/            # Shared utilities, API clients, helpers
│   ├── hooks/          # Shared hooks
│   └── types/          # Shared type definitions
├── public/             # Static assets
├── tests/              # Unit and integration tests
└── docs/               # Architecture notes and decisions
```

**Principles**

- **Feature-first modules** — code is grouped by feature, not by file type, so the app scales without turning into a monolith
- **Typed end-to-end** — TypeScript across the stack
- **Thin components, testable logic** — business logic lives in hooks/services, not in UI
- **Small, reviewable commits** — conventional commit messages (`feat:`, `fix:`, `chore:`)

## 🚀 Getting Started

Once application code lands:

```bash
git clone https://github.com/SakshamKandel/GYM-.git
cd GYM-
npm install
npm run dev
```

## 🗺️ Roadmap

- [x] Repository & project foundation
- [ ] Project scaffold (framework + tooling)
- [ ] Exercise database & workout logging
- [ ] Progress charts & personal records
- [ ] Routine templates
- [ ] Auth & cloud sync

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit style, and PR guidelines.

## 📄 License

[MIT](LICENSE) © Saksham Kandel
