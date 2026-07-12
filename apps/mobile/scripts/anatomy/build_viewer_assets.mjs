import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, '../..');
const outputDir = join(mobileDir, 'src/components/anatomy');

function base64Module(description, exports) {
  const lines = [
    '// AUTO-GENERATED - do not edit by hand.',
    `// ${description}`,
    '// Regenerate with: pnpm --filter mobile anatomy:build-viewer',
    '/* eslint-disable */',
  ];

  for (const [name, bytes] of Object.entries(exports)) {
    const base64 = Buffer.from(bytes).toString('base64');
    const chunks = base64.match(/.{1,120}/g) ?? [];
    lines.push(`export const ${name} = [`);
    for (const chunk of chunks) lines.push(`  ${JSON.stringify(chunk)},`);
    lines.push("].join('');", '');
  }

  return `${lines.join('\n')}\n`;
}

const runtime = await build({
  entryPoints: [join(scriptDir, 'viewer-runtime.mjs')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  minify: true,
  charset: 'ascii',
  legalComments: 'inline',
});

const threeEntry = fileURLToPath(import.meta.resolve('three'));
const threeDir = resolve(dirname(threeEntry), '..');
const dracoDecoder = await readFile(join(threeDir, 'examples/jsm/libs/draco/draco_decoder.js'));
const model = await readFile(join(mobileDir, 'assets/anatomy/muscles.glb'));

await writeFile(
  join(outputDir, 'viewerRuntime.b64.ts'),
  base64Module('Offline Three.js runtime and Draco JavaScript decoder.', {
    VIEWER_RUNTIME_B64: runtime.outputFiles[0].contents,
    DRACO_DECODER_B64: dracoDecoder,
  }),
);

await writeFile(
  join(outputDir, 'muscleModel.b64.ts'),
  base64Module(
    'Z-Anatomy derivative model (CC BY-SA 4.0); see assets/anatomy/ATTRIBUTION.md.',
    { MUSCLES_GLB_B64: model },
  ),
);

console.log(
  `Embedded viewer: ${runtime.outputFiles[0].contents.length.toLocaleString()} bytes; ` +
    `Draco: ${dracoDecoder.length.toLocaleString()} bytes; model: ${model.length.toLocaleString()} bytes.`,
);
