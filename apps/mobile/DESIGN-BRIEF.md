# GYM Tracker — Design Brief (read before building any screen)

The owner supplied a visual reference: a dark sport-training app with a soft
charcoal background, ONE signal-red accent, friendly rounded headings, condensed
stat numerals, pill chips, a horizontal day strip, colorful rounded stat tiles,
and a floating icon tab bar with a red active circle. Match this language
faithfully. The owner explicitly dislikes: glow shadows, blinking/pulsing dots,
blurred gradient blobs. Everything is crisp, solid, rounded.

## Palette (import from `@gym/ui-tokens` — NEVER inline hex)
- `colors.bg` #131416 screen background · `surface` #1D1F22 blocks · `surfaceRaised` #26282C selected/raised
- `colors.accent` (signal red) is reserved for: the action to take NOW, today,
  active states, PRs, the FAB. One red CTA per screen maximum.
- Category tiles may use `colors.blue` / `colors.orange` / `colors.accent`
  (reference uses red/blue/orange tiles). Deep variants for inner icon chips.
- Macro colors are fixed app-wide: kcal=red, protein=blue, carbs=orange,
  fat=yellow (`colors.kcal/protein/carbs/fat/water`).
- Text: `text` off-white, `textDim`, `textFaint`. Never pure #FFF on black.

## Typography (via `<AppText>` — never raw `<Text>`)
- `heading` 34px Poppins semibold, **sentence case** ("Progress", "Food") — one per screen top.
- `title` 20px Poppins semibold — card titles, exercise names.
- `body`/`bodyBold` 16px Poppins — floor is 16, never smaller for reading text.
- `label` 12px Oswald UPPERCASE letter-spaced — micro-label above every big number.
- `display` 40 / `stat` 56 / `statHuge` 76 Oswald — THE numbers (weight, kcal,
  timer, dates). Big numbers always get a label or unit. Tabular numerals are ON.

## Component inventory (`src/components/ui`) — use these, don't reinvent
- `Screen` (scroll, bottomInset, edges) — inside tabs pass `bottomInset={FLOATING_TAB_SPACE}`.
- `Button` (primary red pill 56dp / secondary outline / ghost / danger).
- `Chip` — pill filter (uppercase). `DayStrip` — horizontal date selector with red activity dots.
- `CategoryTile` — colorful tile: title, icon chip, big value + unit. Use for the
  reference-style tile rows (e.g. Volume / Sets / PRs, meal categories).
- `Fab` — red rounded-square + (bottom-right, above tab bar).
- `StatBlock` — label + huge Oswald number + unit. `Ring` — flat SVG progress ring.
- `MacroBar` — adherence-neutral bar (NEVER turns red when over target).
- `Stepper` — ± steppers with long-press repeat; **default input for weight/reps/grams —
  avoid the system keyboard wherever a tap can do the job** (fallback TextInput is ok
  for search fields and custom-food forms).
- `OptionCard` — onboarding answer card. `Divider`, `SectionLabel`, `PressableScale`.

## Layout patterns (match the reference)
- Screen top: `heading` in sentence case; optionally a top row above it
  (avatar/greeting left, small round icon buttons right, 44dp, `surface` bg).
- Prefer hairline `Divider`-separated rows over nested cards for lists.
- Rounded geometry: blocks use `radius.lg` (20) or `radius.xl` (28); chips/buttons pill.
- Thumb zone: primary actions live in the bottom half. Pinned bottom action bars
  sit above the floating tab bar (`FLOATING_TAB_SPACE`).
- Every icon-only control needs `accessibilityLabel`. Touch targets ≥48dp.
- Motion: 120–200ms, transform/opacity only, nothing loops or pulses.
  Haptics via `src/lib/haptics` on every log action (`logHaptic`, `prHaptic`).

## Signature moments (build these exactly)
- **PR stamp, not confetti**: a set that beats history → row flashes red fill once
  (~150ms), `prHaptic()`, and an uppercase "PR" Oswald tag stamps on with a
  1.15→1.0 scale settle. No particles, no loops.
- **Rest timer takeover**: after logging a set, the pinned LOG bar becomes the
  rest timer: 64px Oswald countdown, thin red progress line depleting, ±15s
  steppers at the edges. Auto-starts from the plan's restSec.
- **Trend-first weight**: the headline is the smoothed trend (`smoothWeights`,
  `trendSummary` from `@gym/shared`) with a direction arrow + rate/week; raw
  daily weigh-ins render as small dim dots behind the bold red trend line.
- **Ghosted targets**: in the logger, each empty set row shows last session's
  weight×reps in `textFaint` as the number to beat.

## Data layer (all local-first)
- `src/lib/repo` → `getRepo(): Promise<Repo>` — the ONLY way to read/write logs.
  See `src/lib/repo/types.ts` for the full contract. SQLite on native,
  AsyncStorage-backed on web (so the app must run on web — guard native-only
  modules with `Platform.OS`).
- `src/lib/exercises.ts` — 873 bundled exercises + `searchExercises`,
  `exerciseImageUrl`. Images via `expo-image` (`<Image>` with disk cache).
- `src/lib/seed/plans.ts` — 3 seeded plans; `src/lib/planProgress.ts` — next workout.
- `src/lib/api/openFoodFacts.ts` — `searchFoods`, `lookupBarcode` (free, no key).
- `src/state/profile.ts` — zustand profile/targets/settings (persisted).
- `@gym/shared` — types + pure logic: `checkPr`, `epley1Rm`, `smoothWeights`,
  `trendSummary`, `computeTargets`, `platesFor`, `updateStreak`, `scalePer100`,
  `kcalFromMacros`, `displayWeight`, `inputToKg`, `hasEntitlement`.
- Units: storage is ALWAYS kg; convert at display edge with `displayWeight`/`inputToKg`
  + `unitPref` from the profile store.

## Premium layer (added after owner feedback: "too basic")
- `HeroCard` — gradient charcoal block (tone 'surface'|'red'), `mascot` prop pulls the
  brand character art onto the right edge like the reference's athlete photo.
  EVERY screen gets exactly one hero moment built from this.
- `IconChip` — rounded-square icon anchor for list rows & tiles (deep color inside
  colored tiles, surfaceRaised in plain rows). Meal rows, settings rows, plan rows: all get one.
- `Tag` — Oswald caps micro-tag (PR / UP NEXT / CURRENT / MOST POPULAR), filled|outline|dim.
- `StreakFlame` — the brand Lottie flame (assets/animations/streak.json). ALWAYS use
  this for streak displays, never the Ionicons flame. `active` = streak alive.
- Density: prefer one bold element per viewport-third over many small ones; numbers
  huge (Oswald), supporting text small and dim. Whitespace is part of the design.

## Tier matrix (Feature Blueprint §05 — the ONLY source of truth)
Starter free: basic logger, weight tracking, limited library, 1 generic plan.
Silver: full kcal tracker, food suggestions, all standard programs, progress photos, no ads.
Gold (hero tier): signature GM plans, adaptive progression, meal plans, monthly refresh.
Elite: + 1-on-1 coach chat, video form checks, custom meal plan, priority support.
Gate ONLY via hasEntitlement() with the Feature keys in packages/shared entitlements.ts.

## Animation (required, not optional)
Every screen must move — but with ONE consistent vocabulary (`src/components/ui/motion.ts`):
- **Entrances**: wrap content blocks in `Animated.View` (reanimated) with
  `entering={enterUp(i)}` — stagger sections top-to-bottom (hero i=0, tiles i=1,
  lists i=2…). Headers use `enterDown()`. Section swaps (chips) use `enterFade()`.
- **Lists**: rows added/removed get `layout={layoutSpring}` + `entering={enterUp(0)}`
  so logging a set/food visibly inserts the row.
- **Numbers**: hero stats use `<AnimatedNumber>` (count-up). Rings/MacroBars
  animate themselves (pass `delay` to stagger stacked ones).
- **Press feedback**: PressableScale/Button already spring — never add opacity-only presses.
- Banned: looping/pulsing effects, glow, confetti particles, anything > 600ms.

## Hard rules
- TypeScript strict, no `any`. `npx tsc --noEmit` must pass.
- Features never import from other features — only `packages/*`, `src/lib/*`,
  `src/state/*`, `src/components/ui`.
- Do NOT install packages; everything needed is present (expo-camera, expo-image,
  expo-haptics, react-native-svg, @shopify/flash-list, expo-linear-gradient,
  @expo/vector-icons/Ionicons).
- Do NOT edit: `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, `packages/*`,
  `src/components/ui/*`, `src/lib/*` (read-only foundation).
- Plain language: "Food", "Train", "Body weight" — no jargon.

## SUPERSEDED (2026-07-10)
This file is SUPERSEDED for layout, palette usage and color-blocking by
`REVAMP-BRIEF.md` (color-blocked red/black language). Where the two conflict on
layout/color, REVAMP-BRIEF.md wins. The motion vocabulary, accessibility rules
and anti-glow/anti-pulse laws in this file still apply unchanged.
