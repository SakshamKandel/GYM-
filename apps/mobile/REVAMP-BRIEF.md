# REVAMP BRIEF — color-blocked red/black language (2026-07-10)

Owner-approved visual revamp modeled on the Planable "Activity Planner" mobile
reference, translated to this brand: **SIGNAL RED + BLACK**. This file governs
layout, color-blocking, type and component specs. Motion, accessibility and
anti-glow laws in `DESIGN-BRIEF.md` still apply. **Visual revamp ONLY** — keep
all logic, state, hooks, navigation, route params, a11y labels and entitlement
gating exactly as they are.

## 1. Core language

- Near-black canvas (`colors.bg` = #0B0C0D). Large color-blocked cards with
  **NO hairline borders** — separation comes from fill contrast, never strokes.
- Cards feel like stickers/blocks: chunky radius, generous padding, flat fills.
- Two block colors carry the energy per screen; everything else is charcoal.

## 2. Palette rules (import from `@gym/ui-tokens`; ZERO raw hex in screens)

| Role | Token | Text on it |
|---|---|---|
| Canvas | `colors.bg` | `text` / `textDim` |
| Charcoal cards | `colors.surface` (raised: `surfaceRaised`) | `text` / `textDim` |
| RED hero block (1 per screen) | `colors.blockRed` | `colors.onBlock` (BLACK) |
| Cream counterpoint block (≤1 per screen) | `colors.blockCream` | `onBlock`; secondary `creamDim` |
| Accent details on dark (active states, PR, thin bars) | `colors.accent` | — |

- **Block-ratio rule: exactly ONE red hero block, at most ONE cream block, the
  rest charcoal.** The red block is the screen's energetic center (today's
  workout, the headline stat, the primary module).
- **BLACK text on red and cream** (`onBlock`). White (`text`) ONLY on
  charcoal/black. Never white-on-red, never red text on cream.
- One primary CTA per screen: **black pill on the red block**
  (`bg onBlock`, label `text`), or **red pill on dark** (existing `Button`
  primary) when the CTA lives outside the hero.
- `rgba()` is allowed in exactly two places: photo scrims
  `rgba(0,0,0,0.55–0.75)` and progress-bar tracks on colored blocks
  `rgba(0,0,0,0.15)`. Everything else: tokens.

## 3. Geometry & spacing rhythm

- Color-block cards: `radius.block` (26). Inner elements (nested tiles, image
  frames, inner chips-that-are-squares): `radius.md` (16) — the 14–16 range of
  the reference maps to `radius.md`; never invent in-between values.
- Chips, buttons, nav: full pill (`radius.full`).
- Screen gutter: `spacing.gutter` (20). Card inner padding: `spacing.gutter`.
- Section gap: `spacing.xl` (24); up to 28 (`spacing.xl + spacing.xs`) around
  the hero block. Gaps between sibling cards in a stack: `spacing.md` (12).
- Touch targets ≥48dp (buttons 56). Respect font scaling — no fixed-height
  text containers.

## 4. Typography (via `<AppText>`, never raw `<Text>`)

- **Eyebrow**: `variant="label"` — 12 Oswald UPPERCASE letterspaced, `textDim`
  on dark, `creamDim` on cream, `onBlock` on red. Sits above every big title
  and big number.
- **Screen title**: huge Oswald, 40–56. Default `type.size.heroTitle` (48) —
  `<AppText variant="display" style={{ fontSize: type.size.heroTitle, lineHeight: 54 }}>`
  (if the primitives agent ships a `heroTitle` AppText variant, use that).
  Long titles may drop to `variant="display"` (40). UPPERCASE reads best in
  Oswald ("TODAY'S TRAINING", "ACTIVITY PLANNER" style).
- **Card titles**: `variant="title"` (20 Poppins semibold). Body: `variant="body"`
  (16 floor). Captions 13 for units/axis only — never reading text.
- **Fraction stats**: numerator `variant="stat"` (56 Oswald) + denominator
  `variant="title"` dimmed, baseline-aligned: `24` big, `/30` small-dim.
- No new fonts. Oswald = display/numbers/eyebrows; Poppins = everything read.

## 5. Screen header pattern (every top-level screen)

Order: eyebrow → huge Oswald title → meta chips row.

```tsx
<View style={{ paddingHorizontal: spacing.gutter, gap: spacing.sm }}>
  <AppText variant="label">Week 12 · Push day</AppText>
  <AppText variant="display" style={{ fontSize: type.size.heroTitle, lineHeight: 54 }}>
    TODAY'S{'\n'}TRAINING
  </AppText>
  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
    <MetaChip label="Thu, Jul 10" />
    <MetaChip label="6 exercises" />
  </View>
</View>
```

Wrap in `Animated.View entering={enterDown()}` like existing headers.

## 6. Chips & pills

- **Meta chip on dark (outlined)**: transparent bg, 1px `colors.borderStrong`
  border, `radius.full`, height 34–36, `paddingHorizontal: spacing.lg`, label =
  `variant="label"` color `text` (or `caption` for mixed-case dates). Chips ARE
  allowed borders — the no-border law is for cards.
- **Chip inside red/cream block (filled)**: bg `colors.onBlock`, same pill
  metrics, label color `colors.text`. No border.
- **Interactive filter chips**: keep existing `Chip` component (selected = red
  fill). Pressable chips need a ≥48dp hit area (minHeight or hitSlop).

## 7. Progress & stats

- **Bars**: height 8–10, `borderRadius: radius.full`, fill animates via existing
  patterns (`MacroBar` self-animates). Track: `colors.surfaceRaised` on dark;
  `rgba(0,0,0,0.15)` on red/cream blocks. Fill: `colors.accent` on dark;
  `colors.onBlock` on red/cream.
- **Rings**: existing `Ring` component, placed at a block's top/right corner as
  in the reference. On colored blocks pass ring colors from tokens
  (`onBlock` progress over the rgba track color).
- Big numbers always get an eyebrow label or unit.

## 8. Photos (optional accents, not heroes)

- Sources: `assets/images/stock/*` via `stockImages`. **Max ONE photo per
  screen**; many screens should have none — color blocks carry the design.
- Always framed INSIDE a rounded block (`radius.md` frame inside a
  `radius.block` card), never full-bleed edge-to-edge.
- Text over a photo requires a scrim `rgba(0,0,0,0.55–0.75)` and ≥4.5:1 contrast.

## 9. Bottom nav (FloatingTabBar owner only)

Compact centered dark pill: bg `colors.surfaceRaised`, `radius.full`, icons
only (no labels), inactive icons `textDim`, **active icon sits in a filled
`colors.accent` circle (≥44dp) with `colors.onBlock` icon**. No glow shadow —
elevation via the pill's fill contrast against `bg` only. Keep
`FLOATING_TAB_SPACE` and all navigation wiring untouched.

## 10. DO / DON'T

DO: fill-contrast separation · one red hero per screen · black text on colored
blocks · pill chips/buttons · huge Oswald titles with eyebrows · thick rounded
bars · `enterUp/enterDown/enterFade` staggers (120–200ms).

DON'T: borders/strokes on cards (`borderWidth` on any card = bug) · glow
shadows · pulsing/blinking/looping anything · blurred gradient blobs ·
gradients as decoration · new fonts · raw hex/rgba outside the two sanctioned
rgba uses · more than one red block · white text on red/cream · more than one
primary CTA · logic/behavior changes.

## 11. Worked sketches

### (a) Screen header — see §5.

### (b) Red hero block: fraction stat + progress bar + pill CTA

```tsx
<View style={styles.hero}>
  <AppText variant="label" color={colors.onBlock}>Sets this week</AppText>
  <View style={styles.fractionRow}>
    <AppText variant="stat" color={colors.onBlock}>24</AppText>
    <AppText variant="title" color={colors.onBlock} style={{ opacity: 0.6 }}>/30</AppText>
  </View>
  <View style={styles.track}>
    <View style={[styles.fill, { width: '80%' }]} />
  </View>
  <Button variant="onBlock" label="Start workout" onPress={startWorkout} />
  {/* until Button ships an on-block variant, a PressableScale pill:
      bg colors.onBlock, height 56, radius.full, label <AppText bodyBold color={colors.text}> */}
</View>

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  fractionRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  track: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.15)', // sanctioned: track on colored block
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.onBlock },
});
```

### (c) Charcoal list row (no borders, no Divider hairlines between cards)

```tsx
<PressableScale onPress={onPress} style={styles.row} accessibilityLabel={name}>
  <IconChip icon="barbell-outline" />
  <View style={{ flex: 1, gap: 2 }}>
    <AppText variant="bodyBold">{name}</AppText>
    <AppText variant="caption">{setsSummary}</AppText>
  </View>
  <AppText variant="label">{meta}</AppText>
</PressableScale>

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
});
```

Rows in a stack: gap `spacing.sm`–`spacing.md` between rounded rows — this
replaces `Divider` hairlines inside the revamped list look.

## 12. Verify before you finish

`cd "E:/GYM Tracker/apps/mobile" && npx tsc --noEmit` — your files clean.
Report: files changed, layout decisions, anything skipped.
