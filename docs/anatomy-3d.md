# Offline 3D anatomy viewer

The anatomy explorer and training muscle-focus section now share a real,
rotatable 3D body on iOS, Android, and web. Selecting a muscle from the body or
the chip strip updates the same app state, coaching copy, and filtered exercise
list.

## Shipped design

- A clean outer body is assembled from Z-Anatomy's skin-region surfaces. The
  two rear anal patches are intentionally omitted from the visible skin
  because the atlas' open crotch made them visible from the front.
- Real dark training shorts are built from the pelvis/upper-thigh skin
  patches: the sheet is inflated ~10 mm off the body along outward normals,
  then cut with a straight waistband (z 0.955) and mid-thigh hem (z 0.67).
  A flat ellipsoid plugs the atlas' patchless pubic triangle. Highlight
  zones covered by the garment band are lifted above the fabric at export
  time so glute/quad/hamstring heat maps stay visible on top of the shorts.
- Seventeen fitted `highlight <group>` surface meshes match the app's
  `MUSCLE_GROUPS`. At first selection the viewer computes a boundary-distance
  field over each zone (vertices welded by position, small boundary loops
  ignored, SPFA over surface edges) and bakes it into vertex colors: deep
  red at the rim ramps to a bright red-orange core and feathers softly to
  transparent, so the glow follows the region's true silhouette and reads
  identically over skin and fabric. The zone material is lit and emissive
  (`MeshStandardMaterial`), so body curvature shades the glow, and the
  emissive intensity breathes for ~6 s after each selection before settling.
- Seventeen detailed muscle meshes remain in the GLB as a hidden fallback
  picking layer. The lighter fitted regions are the normal tap targets.
- Joined sclera and iris meshes keep the face readable without textures.
- The scene uses the app's black canvas, token colors, soft studio lighting,
  drag orbit, pinch zoom, and Front/Back controls.

## Runtime architecture

The shared renderer lives in:

- `apps/mobile/src/components/anatomy/Anatomy3DViewer.tsx` — native WebView host
- `apps/mobile/src/components/anatomy/Anatomy3DViewer.web.tsx` — sandboxed web iframe
- `apps/mobile/src/components/anatomy/buildViewerHtml.ts` — Three.js scene and bridge
- `apps/mobile/src/components/anatomy/Anatomy2DViewer.tsx` — accessible SVG fallback

Three.js, the JavaScript Draco decoder, and the GLB are generated into local
base64 TypeScript modules. The viewer performs no runtime network request and
therefore remains available in an offline gym. A procedural 3D figure is used
if GLB decoding fails; the host switches to the SVG body if the WebView/WebGL
runtime fails or does not report ready within 15 seconds.

The bridge messages are deliberately small:

```text
viewer -> app: { type: "ready" }
viewer -> app: { type: "select", muscle: "chest" }
app -> viewer: { type: "highlight", muscle: "chest", side: "front" }
```

## Rebuilding the asset

The reproducible exporter is in `apps/mobile/scripts/anatomy/` and runs against
Z-Anatomy's `Startup.blend`:

```sh
blender --background Startup.blend \
  --python apps/mobile/scripts/anatomy/build_glb.py
pnpm --filter mobile anatomy:build-viewer
```

The exporter classifies 787 source muscle objects into the app's 17 groups,
decimates the hidden picking geometry at the default `0.45` ratio, joins the
  outer surface and highlight zones, adds the neutral modesty layer and eyes, then
exports a Draco-compressed GLB (compression level 6, position quantization 12,
normal quantization 10). It also renders front/back verification images and a
`build_report.json` file.

The current output contains 39 meshes and ≈472,000 triangles in a
1,372,452-byte GLB: 17 hidden anatomical pickers (404,689 tris), 17 fitted
highlight zones (19,326), the outer body (43,884), two eye meshes, the offset
training shorts (2,672), and its pubic-gap bridge (528).

Important rules:

- Do not render the detailed internal muscles as the body surface; deep
  shoulder and abdominal structures create spikes and gaps.
- Do not enable global front-face culling. The atlas' disconnected skin patches
  have inconsistent winding, so the body surface must remain double-sided.
- Keep transparent highlights at `depthWrite: false` with polygon offset to
  avoid coplanar flicker on mobile GPUs.
- Regenerate both embedded base64 modules after every GLB or Three.js runtime
  change.

## Verification status

- [x] Web: chest, shoulders, abdominals, Front/Back, and direct body taps checked
- [x] Runtime, Draco decoder, and model are embedded with no CDN dependency
- [x] SVG fallback remains selectable and token-styled
- [ ] Measure tap-to-app latency on a physical mid-range Android device
- [ ] Confirm orbit/zoom performance and airplane mode on physical iOS/Android

## Attribution

The derivative model is based on Z-Anatomy and BodyParts3D. Full source links,
license wording, modifications, and Share-Alike notice are in
`apps/mobile/assets/anatomy/ATTRIBUTION.md` and summarized in Settings.
