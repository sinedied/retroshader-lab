// Generates src/generated/shader-manifest.json from the shaders bundled in public/shaders/glsl
// and the screenshots bundled in public/samples.
// The manifest is only a list of file names, the assets themselves are fetched at runtime
// exactly like NextUI reads them from the Shaders/glsl folder.
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const glslDir = resolve(root, 'public/shaders/glsl');
const samplesDir = resolve(root, 'public/samples');
const outFile = resolve(root, 'src/generated/shader-manifest.json');

const byName = (a, b) => a.localeCompare(b);
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

const shaders = readdirSync(glslDir)
  .filter((file) => file.endsWith('.glsl'))
  .sort(byName);

const samples = existsSync(samplesDir)
  ? readdirSync(samplesDir)
      .filter((file) => IMAGE_RE.test(file))
      .sort(byName)
  : [];

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify({ shaders, samples }, undefined, 2)}\n`);

console.log(
  `manifest: ${shaders.length} shaders, ${samples.length} sample screenshots -> ${outFile}`
);

