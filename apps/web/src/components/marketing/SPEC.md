# GM Method marketing site — build spec (2026-07-21 v3 "Paper & Iron")

Award-tier hybrid SaaS site: **dark cinematic hero → light, Notion-clean
content sections → dark closing band**. This file is LAW for every marketing
page. Read the exemplar code before writing anything:

- `ui.tsx` — Section/Container/Hairline/Eyebrow/Display/Lead/PillLink/ArrowLink/Card/StatBig/CheckItem/PhotoBlock/LogoMark
- `motion.tsx` — Reveal/Stagger/StaggerItem/WordStagger/Parallax/Float/Magnetic/Marquee/CountUp/useInView/useStepLoop/useReducedMotion (built on `motion/react`; SPRING is the house ease)
- `PhoneFrame.tsx` — PhoneFrame (334×710 screen canvas) + BrowserFrame
- `screens/appkit.tsx` — AppScreen/AppStatusBar/AppEyebrow/AppTitle/AppStat/BlockCard/MetaChip/BlockPill/MiniBar/MiniRing/AppTabBar/AvatarDot
- Exemplar screens: `screens/TodayScreen.tsx`, `screens/OrderTrackerScreen.tsx`, `screens/TrendChartCard.tsx`
- Exemplar page: `src/app/page.tsx` + `home/*.tsx` (Hero, TruthMarquee, Modules, Spotlights, PricingTeaser, Closing)

## Hard laws

1. Every page wraps content in `<Shell>` from `@/components/marketing/Shell`.
   Never edit shared files (ui/motion/PhoneFrame/appkit/Shell/Nav/Footer/
   marketing.css/globals.css/layout.tsx) — read-only.
2. Tailwind only (v4, tokens below). No new CSS files, no CSS modules, no
   inline `style` except dynamic values (chart coords, transforms, delays).
3. AESTHETIC v3 — "Paper & Iron": every page runs the same rhythm —
   **(a) dark hero** (`tone="ink"`, `mkt-aurora` + grid, ember light, steel /
   one-ember-word display type, `WordStagger` headline, device visual),
   **(b) light content** — alternate `Section tone="paper"` / `tone="paper-2"`,
   white hairline cards (`mkt-card-light` + `mkt-card-light-hover` via
   `Card tone="light"`), gravel secondary text, ONE red accent per view,
   **(c) dark closing** — photo band with scrim + parallax, or flat ink.
   Mid-page you may use ONE saturated band (`tone="red"` — coaching moment)
   OR one extra ink band, never both. Glass (`mkt-glass*`) belongs to dark
   sections ONLY — banned on paper. Flat `bg-charcoal` cards banned everywhere.
   Full-width hairline `border-t` is banned — use `<Hairline />` (content
   width). Red discipline: black text on red; never white on red.
4. Type: `font-display` (Oswald) UPPERCASE for headlines + numerals (`Display`).
   `font-sans` (Poppins) for reading text (≥14.5px). `font-mono` (IBM Plex
   Mono) 11–12px uppercase tracked for eyebrows/captions. On paper: headings
   `text-ink`, body `text-gravel`, micro `text-gravel-faint`.
5. Motion (all from `motion.tsx`, never hand-rolled): `Reveal` for section
   copy (stagger siblings with `delay`), `Stagger`/`StaggerItem` for card
   grids, `WordStagger` for hero/closing display headlines, `Parallax` on
   phones/photos inside light sections, `Magnetic` around hero + closing CTAs,
   `CountUp` for numerals, `Marquee` for truth strips. Everything already
   honors reduced motion (MotionConfig in Shell) — do not add raw
   `motion.div` unless a primitive genuinely can't express the effect.
6. Honesty: NO invented user counts, ratings, download numbers or fake
   company logos. Product-truth stats only (offline <100 ms logging, 17
   anatomy zones, 7 order states, 2 price regions, 10 card faces…).
   Testimonials are first-name personas only.
7. Every page: unique `metadata` title + description; `h1` via
   `<Display as="h1">` or a styled `<h1>` with `WordStagger`; images get real
   `alt`; links use `next/link` via PillLink/ArrowLink.
8. Phones: `<PhoneFrame tilt scale>` wrapped in `<Parallax range={48}>` on
   light sections — vary tilt between adjacent phones, never two identical
   angles side by side, no decorative floating chips around devices. Screen
   mockups must look like the REAL app: near-black canvas, ONE red block per
   mock screen, chunky borderless cards, Oswald numerals, `AppTabBar` with the
   correct active tab. Mock screens stay dark inside the phone even on paper
   sections — that's the "Iron" inside the "Paper".
9. Mock screens are UNIQUE site-wide. Never import another page's screens.
   Reserved (already used by Home): TodayScreen, RestTimerScreen, MacroScreen,
   OrderTrackerScreen, CoachChatScreen, TrendChartCard.
10. TypeScript strict, no `any`. Components client (`'use client'`) only when
    they animate or hold state (anything importing motion.tsx is client).
11. Nav is theme-aware automatically: transparent over the dark hero, white
    pill over paper. Every page MUST therefore open with a dark hero — never
    lead with a paper section.

## Tailwind tokens (defined in marketing.css)

Dark: `ink #0B0C0D` · `coal #131416` · `charcoal*` · `line`/`line-strong` ·
`snow` · `dim` · `faint`. Light: `paper #FAFAF7` (canvas) · `paper-2 #F2F1EB`
(alt band) · `mist` / `mist-strong` (hairlines) · `gravel` (secondary text) ·
`gravel-faint` (micro). Brand: `red #FF3B30` · `red-deep` (accent text on
paper) · `red-glow` · `cream*` (legacy, prefer paper tones). Data: `blue
orange gold water mint`. Radii: `rounded-block` (26px) · `rounded-inner`
(16px). Shadows: `shadow-phone`, `shadow-pop`, `shadow-ember`, `shadow-ember-lg`,
`shadow-glass`, `shadow-card`, `shadow-card-hover`, `shadow-nav`.
Helpers: `.mkt-aurora` / `.mkt-aurora-quiet`, `.mkt-gridlines` /
`.mkt-gridlines-light`, `.mkt-noise` / `.mkt-noise-light`, `.mkt-glass` /
`.mkt-glass-deep` (dark only), `.mkt-card-hover` (dark) /
`.mkt-card-light` + `.mkt-card-light-hover` (paper), `.mkt-text-steel` /
`.mkt-text-ember` (dark display type only), `.mkt-divider` (dark) /
`.mkt-hairline` (paper), `.mkt-shine`, `.mkt-word-mask`, `.mkt-marquee`.
BANNED on v3 pages: `.mkt-outline-text`, glass on paper, full-bleed `border-t`
hairlines, more than one red/ink mid-page band.

## Page anatomy (adapt, don't template-stamp)

1. Hero (ink): `pt-[120px] sm:pt-[140px]`, eyebrow pill → `WordStagger`
   headline (2–3 stacked lines, one ember word max) → `Lead tone="dark"` →
   `Magnetic` CTAs → device visual with `Float`. Vary hero layouts between
   pages (split, centered, device-right, device-peeking-from-bottom).
2. Optional truth `Marquee` ribbon (ink, `border-y border-white/8`).
3. Proof band on paper: 3–4 `StatBig tone="light"` / product-truth numerals.
4. 3–5 deep-dive sections: alternate `paper` / `paper-2`, alternate
   copy-left/copy-right, mix phones (`Parallax`) with non-phone visuals
   (charts, SVG diagrams, `PhotoBlock`, table cards).
5. Cross-links: a "Keep exploring" 2–3 card row (`Card tone="light" hover`).
6. Closing CTA (ink): photo w/ `bg-black/70` scrim + parallax OR flat ink
   with aurora — `WordStagger` headline + `Magnetic` CTAs.

## Copy voice

Plain, confident, a little dry. Short sentences. Concrete over hype: never
"unleash/revolutionize/supercharge/next-level". Kathmandu-proud, globally
priced. Headlines punchy (2–5 words per line). Leads ≤ 3 sentences.

## Photos (in /public/stock/, licensed) — keep assignments to avoid repeats

training: deadlift-dark, barbell-grip-overhead, pullups-bw ·
nutrition: food-healthy ·
progress: squat-woman-bw, running-stairs ·
coaching: overhead-press-woman, woman-squat-portrait-bw ·
gyms: gym-interior-bright, gym-dumbbells, gym-empty-bw ·
meals: food-bowl ·
about: runner-track, runners-silhouette-blue, yoga ·
download: dumbbell-rack-grab · (hero-barbell is Home's — don't reuse)
Brand: /brand/mascot.png (mascot logo), /brand/mascot-alt.png, /brand/newie.png.
Always inside `PhotoBlock` / rounded frames — never full-bleed except closing
CTA backgrounds with a scrim.

## Verification (every agent, before returning)

`cd "E:/GYM Tracker/apps/web" && pnpm exec tsc --noEmit` — YOUR files must be
error-free (ignore errors in other agents' in-flight pages). Check every link
you emit targets a real route: / /training /nutrition /progress /coaching
/meals /gyms /pricing /partners /for-coaches /download /about /contact
/privacy /terms /coach/login /partner/login /admin/login.
