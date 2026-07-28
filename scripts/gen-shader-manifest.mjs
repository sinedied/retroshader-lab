// Generates src/generated/shader-manifest.json from the assets bundled in public/:
//   - the shaders in public/shaders/glsl
//   - the stock NextUI presets in public/shaders/presets
//   - the screenshots in public/samples (metadata read from public/samples/index.json)
// The manifest only lists names and metadata; the assets themselves are fetched at
// runtime exactly like NextUI reads them from the SD card.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const glslDir = resolve(root, 'public/shaders/glsl');
const presetsDir = resolve(root, 'public/shaders/presets');
const samplesDir = resolve(root, 'public/samples');
const outFile = resolve(root, 'src/generated/shader-manifest.json');

const byName = (a, b) => a.localeCompare(b);
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

const shaders = readdirSync(glslDir)
  .filter((file) => file.endsWith('.glsl'))
  .sort(byName);

/** Preset paths relative to public/shaders/presets, e.g. `sets/GB/Sharp.cfg`. */
function collectPresets(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir).sort(byName)) {
    const full = join(dir, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) found.push(...collectPresets(full, relative));
    else if (entry.endsWith('.cfg')) found.push(relative);
  }
  return found;
}

const presets = collectPresets(presetsDir);

/** Screenshots, enriched with the platform/title metadata written at download time. */
const sampleFiles = existsSync(samplesDir)
  ? readdirSync(samplesDir)
      .filter((file) => IMAGE_RE.test(file))
      .sort(byName)
  : [];

let sampleMeta = [];
const indexFile = resolve(samplesDir, 'index.json');
if (existsSync(indexFile)) {
  try {
    sampleMeta = JSON.parse(readFileSync(indexFile, 'utf8'));
  } catch (error) {
    console.warn(`samples/index.json is not valid JSON, ignoring it: ${error.message}`);
  }
}

const samples = sampleFiles.map((file) => {
  const meta = sampleMeta.find((entry) => entry.file === file);
  return meta
    ? {
        file,
        system: meta.system,
        platform: meta.platform,
        title: meta.title,
        width: meta.width,
        height: meta.height
      }
    : { file, title: file.replace(IMAGE_RE, '') };
});

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify({ shaders, presets, samples }, undefined, 2)}\n`);

console.log(
  `manifest: ${shaders.length} shaders, ${presets.length} presets, ${samples.length} screenshots -> ${outFile}`
);
