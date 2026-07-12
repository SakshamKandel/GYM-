# 3D anatomy model attribution

`muscles.glb` and its embedded copy in
`src/components/anatomy/muscleModel.b64.ts` are a modified derivative based on:

- **Z-Anatomy — The libre 3D atlas of anatomy** — CC BY-SA 4.0  
  Source: https://github.com/LluisV/Z-Anatomy  
  License: https://creativecommons.org/licenses/by-sa/4.0/
- **BodyParts3D — The Database Center for Life Science** — CC BY-SA 2.1 Japan  
  Source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html  
  License: https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en

## Modifications made for this app

- Classified 787 source muscle objects into the app's 17 training groups.
- Kept the detailed muscle meshes hidden for fallback hit testing rather than
  exposing deep anatomy as the visible body.
- Joined the atlas skin regions into a clean outer surface, omitted two tiny
  rear anal-region patches that showed through the open front crotch, and added
  a fitted dark training-short modesty layer with a flat gap-closing bridge.
- Duplicated selected outer regions into 17 fitted heat-map highlight meshes.
- Joined the sclera and iris meshes, trimmed hand/foot muscle spill, repaired a
  missing bilateral shoulder side, decimated, normalized, and Draco-compressed
  the final glTF 2.0 binary.
- Replaced the source materials with app-token-driven skin, eye, lighting, and
  red/orange heat-map materials at runtime.

The exact reproducible exporter is in `apps/mobile/scripts/anatomy/`; further
implementation details are documented in `docs/anatomy-3d.md`.

## Share-Alike notice

This derivative model (`muscles.glb` and its encoded copy) is distributed under
**CC BY-SA 4.0**. The Share-Alike requirement applies to the derivative model,
not to unrelated application source code. BodyParts3D remains separately
credited under **CC BY-SA 2.1 Japan** as required by its source license.
