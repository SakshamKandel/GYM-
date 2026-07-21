/**
 * Exports the app's self-contained 3D anatomy viewer as a static HTML file for
 * the marketing site (apps/web/public/anatomy/viewer.html). The marketing page
 * embeds it in an <iframe> and drives it over the same postMessage bridge the
 * app uses. Re-run after `anatomy:build-viewer` regenerates the b64 modules:
 *   pnpm exec tsx apps/mobile/scripts/anatomy/export_web_viewer.ts   (repo root)
 */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildViewerHtml } from '../../src/components/anatomy/buildViewerHtml';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../web/public/anatomy');
mkdirSync(outDir, { recursive: true });

const html = buildViewerHtml({ selected: null, side: 'front', autoRotate: true });
writeFileSync(resolve(outDir, 'viewer.html'), html, 'utf8');
copyFileSync(resolve(here, '../../assets/anatomy/ATTRIBUTION.md'), resolve(outDir, 'ATTRIBUTION.md'));

console.log(`wrote ${resolve(outDir, 'viewer.html')} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
