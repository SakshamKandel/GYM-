import type { MuscleGroup } from '../../lib/muscleMap';
import type { MuscleMapSide } from '../../lib/muscleMapData';

/**
 * Feature flag for the true-3D anatomy viewer.
 *
 * `ANATOMY_3D_ENABLED` turns the WebGL body on. Web renders it in an
 * `<iframe>`; native renders it in the Expo-supported
 * `react-native-webview`. Three.js, Draco, and the GLB are embedded locally,
 * so rendering does not need a network connection. Each platform variant
 * guards runtime failures and automatically switches to `Anatomy2DViewer`.
 *
 * The webview import lives ONLY in the native `Anatomy3DViewer.tsx` so Metro
 * never pulls it into the web bundle — keep this shared module free of any
 * `react-native-webview` reference.
 *
 * Shared component (lives in components/, not features/) so both the anatomy
 * encyclopedia (features/anatomy) and the workout muscle selector
 * (features/training) can use it without crossing feature modules (CLAUDE.md
 * hard rule 2).
 */

export const ANATOMY_3D_ENABLED = true;

export interface Anatomy3DViewerProps {
  /** Highlighted muscle group, or null for none. */
  selected: MuscleGroup | null;
  /** Fired when the user taps a muscle in the 3D scene. */
  onSelect: (muscle: MuscleGroup) => void;
  /** Which face to present; the camera turns to match. */
  side: MuscleMapSide;
  /** Body render height in px; the viewer fills its parent's width. */
  height?: number;
  /**
   * Render the built-in hint + "Selected" label overlays (default true). Set
   * false when the host screen already shows its own chrome around the body.
   */
  overlays?: boolean;
  /** When provided, show Front/Back chips that toggle the presented face. */
  onSideChange?: (side: MuscleMapSide) => void;
}
