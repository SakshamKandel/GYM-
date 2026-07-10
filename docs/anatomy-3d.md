# True-3D anatomy upgrade path

The in-app anatomy explorer (`apps/mobile/src/features/anatomy/`) ships today as a
**pseudo-3D rotatable body**: perspective `rotateY` with anatomically drawn
front/back faces (MuscleMapJS paths), drag-to-rotate 360°, pinch zoom, tap-to-select,
plus the offline muscle knowledge base. It needs no new native modules and works
on iOS/Android/web.

This doc records the vetted path to a **true mesh-based 3D model** (single rotatable
GLB with per-muscle picking) when the owner wants to invest in it.

## Why not react-three-fiber today (checked 2026-07-10)

- `@react-three/fiber` native support is mid-migration to `@react-three/native`
  (R3F v10) — the repo header literally says **"Active Migration! DO NOT USE YET"**.
- Published R3F v9 pins an old `expo-gl` that conflicts with SDK 5x's `expo-gl`,
  breaking real devices while working on web — worst possible failure mode.
- pmndrs team direction is WebGPU-first for native; ExpoGL path has known perf issues.

**Verdict:** the stable route on Expo SDK 57 is a `react-native-webview` hosting
three.js (WebGL) with a `postMessage` bridge. Revisit R3F when `@react-three/native`
ships stable.

## Asset: the licensed model

1. Source: **Z-Anatomy** (CC BY-SA 4.0) — full human anatomy in Blender format.
   Repo: `github.com/LluisV/Z-Anatomy` (models via the README's Drive link).
2. In Blender: keep ONLY the *muscular system* collection + body silhouette.
   Join muscles into ~17 named meshes matching the app's `MUSCLE_GROUPS`
   (`apps/mobile/src/lib/exercises.ts`) — e.g. name meshes `chest`, `lats`,
   `quadriceps`… Decimate to ≤150k total tris.
3. Export glTF 2.0 → `muscles.glb`, Draco compression on, no textures needed
   (solid materials recolor at runtime). Target ≤8 MB.
4. Place at `apps/mobile/assets/anatomy/muscles.glb`.
5. Attribution: add "3D anatomy model © Z-Anatomy, CC BY-SA 4.0" to the app's
   credits/settings screen (same place the MuscleMapJS credit lives).

## Wiring (when the asset exists)

1. `cd apps/mobile && npx expo install react-native-webview` and rebuild the dev
   client (`eas build --profile development`).
2. Add `features/anatomy/Anatomy3DViewer.tsx`: a `WebView` rendering an inline
   HTML page that imports three.js (bundle it locally via `require('./three.min.js')`
   asset or pin a CDN with an offline fallback), loads the GLB with
   `GLTFLoader` + `DRACOLoader`, `OrbitControls` for 360° rotate/zoom.
3. Bridge:
   - RN → web: `postMessage({ type: 'highlight', muscle: 'chest' })` — viewer sets
     the mesh's material emissive/color to the accent red, rest stay charcoal.
   - web → RN: raycast on tap, `window.ReactNativeWebView.postMessage({ type:
     'select', muscle: mesh.name })` — RN updates the selected muscle + info panel.
4. In `AnatomyExplorer.tsx`, render `Anatomy3DViewer` instead of `AnatomyBody`
   when the flag in `features/anatomy/config.ts` is on; keep `AnatomyBody` as the
   universal fallback (web build, low-end devices, asset missing).
5. Theme the WebView page with the same hex values as `@gym/ui-tokens` (bg
   `#0B0C0D`, accent `#FF3B30`) — tokens can't cross the WebView boundary.

## Acceptance checklist

- [ ] 360° orbit + pinch zoom at 60fps on a mid-range Android device
- [ ] Tap any muscle → selection reaches RN in <100ms
- [ ] Highlight from RN (chip strip) recolors the mesh
- [ ] Airplane mode: viewer still loads (no CDN dependency at runtime)
- [ ] Fallback renders when the GLB or webview module is absent
- [ ] CC BY-SA attribution visible in-app
