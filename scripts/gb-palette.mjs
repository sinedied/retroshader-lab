#!/usr/bin/env node
/**
 * Recolours a Game Boy screenshot into any of Gambatte's palettes.
 *
 *   npm run palette -- --list [filter]
 *   npm run palette -- <input.png> "TWB64 040 - DMG Ver." [-o output.png]
 *
 * Palettes are read from the vendored `scripts/vendor/gbcpalettes.h`, which is the
 * table Gambatte itself uses — see scripts/vendor/NOTICE for its licence. Parsing it
 * rather than keeping our own copy means an upstream refresh picks up new palettes
 * for free.
 *
 * Colour handling: `TO5BIT` is applied verbatim from the header, because Gambatte packs
 * every palette to 5 bits per channel, then expanded back with round-to-nearest. The
 * core emits RGB565 and leaves the widening to the frontend, so this matches what the
 * device actually shows rather than the palette author's raw 24-bit value.
 *
 * Indexed PNGs — which is what Game Boy screenshots normally are — are recoloured by
 * rewriting the PLTE chunk, so not a single pixel is touched. Truecolour inputs are
 * decoded, each pixel matched to the nearest of the four source shades by luminance,
 * and re-encoded.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const HEADER = resolve(here, 'vendor/gbcpalettes.h');

/* ------------------------------------------------------------------ palettes */

/** `TO5BIT` exactly as the vendored header defines it. */
const to5bit = (c8) => Math.floor((c8 * 0x1f * 2 + 0xff) / (0xff * 2));
/** Widen 5 bits back to 8, round to nearest. */
const to8bit = (c5) => Math.round((c5 * 255) / 31);
const quantize = (rgb24) => {
  const r = to8bit(to5bit((rgb24 >> 16) & 0xff));
  const g = to8bit(to5bit((rgb24 >> 8) & 0xff));
  const b = to8bit(to5bit(rgb24 & 0xff));
  return [r, g, b];
};

/** Parses the vendored header into `display name -> four background colours`. */
export function loadPalettes() {
  if (!existsSync(HEADER)) {
    throw new Error(`Missing ${HEADER} — see scripts/vendor/NOTICE`);
  }
  const source = readFileSync(HEADER, 'utf8');

  // static const unsigned short <symbol>[] = { PACK15_4(0x.., 0x.., 0x.., 0x..), ... };
  // Some entries carry a trailing `// comment` between the brace and the first row.
  const colours = new Map();
  const arrayRe =
    /static\s+const\s+unsigned\s+short\s+(\w+)\s*\[\]\s*=\s*\{[^\n]*\r?\n?\s*PACK15_4\(([^)]*)\)/g;
  for (const [, symbol, args] of source.matchAll(arrayRe)) {
    const values = args.split(',').map((part) => Number.parseInt(part.trim(), 16));
    if (values.length === 4 && values.every((v) => Number.isFinite(v))) {
      colours.set(symbol, values.map(quantize));
    }
  }

  // { "Display name", symbol },
  const palettes = new Map();
  const tableRe = /\{\s*"([^"]+)"\s*,\s*(\w+)\s*\}/g;
  for (const [, title, symbol] of source.matchAll(tableRe)) {
    const rgb = colours.get(symbol);
    if (rgb && !palettes.has(title)) palettes.set(title, rgb);
  }

  if (palettes.size === 0) throw new Error('No palettes parsed — has the header format changed?');
  return palettes;
}

const hex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/* ----------------------------------------------------------------------- PNG */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('Not a PNG');
  const chunks = [];
  let pos = 8;
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    chunks.push({ type, data });
    pos += 12 + length;
  }
  return chunks;
}

function writeChunks(chunks) {
  const parts = [PNG_MAGIC];
  for (const { type, data } of chunks) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
    parts.push(length, typeBuf, data, crc);
  }
  return Buffer.concat(parts);
}

const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Indexed PNG: rewrite PLTE. Only the entries the image actually uses are remapped,
 * ordered by luminance so the lightest shade takes the palette's first colour.
 */
function recolourIndexed(chunks, palette) {
  const plte = chunks.find((c) => c.type === 'PLTE');
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];

  // which palette indices does the image use?
  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
  );
  const used = new Set();
  const bytesPerRow = Math.ceil((width * bitDepth) / 8);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (bytesPerRow + 1) + 1, (y + 1) * (bytesPerRow + 1));
    for (const byte of row) {
      if (bitDepth === 8) used.add(byte);
      else for (let s = 8 - bitDepth; s >= 0; s -= bitDepth) used.add((byte >> s) & ((1 << bitDepth) - 1));
    }
  }

  const entries = [...used].map((index) => ({
    index,
    rgb: [plte.data[index * 3], plte.data[index * 3 + 1], plte.data[index * 3 + 2]]
  }));
  if (entries.length > palette.length) {
    throw new Error(
      `Image uses ${entries.length} colours, the palette has ${palette.length}. ` +
        'Expected a 4-shade Game Boy screenshot.'
    );
  }

  // lightest source shade -> first palette colour
  entries.sort((a, b) => luma(b.rgb) - luma(a.rgb));
  const data = Buffer.from(plte.data);
  entries.forEach((entry, i) => {
    const [r, g, b] = palette[i];
    data[entry.index * 3] = r;
    data[entry.index * 3 + 1] = g;
    data[entry.index * 3 + 2] = b;
  });

  return {
    chunks: chunks.map((c) => (c.type === 'PLTE' ? { type: 'PLTE', data } : c)),
    shades: entries.map((e) => e.rgb)
  };
}

/** Truecolour PNG: decode with pngjs, map each pixel, re-encode. */
async function recolourTruecolour(buffer, palette) {
  let PNG;
  try {
    ({ PNG } = await import('pngjs'));
  } catch {
    throw new Error('Truecolour input needs pngjs — run: npm install');
  }
  const png = PNG.sync.read(buffer);

  const counts = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const key = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const shades = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, palette.length)
    .map(([key]) => [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff])
    .sort((a, b) => luma(b) - luma(a));

  for (let i = 0; i < png.data.length; i += 4) {
    const pixel = [png.data[i], png.data[i + 1], png.data[i + 2]];
    let best = 0;
    let bestDelta = Infinity;
    shades.forEach((shade, s) => {
      const delta = Math.abs(luma(shade) - luma(pixel));
      if (delta < bestDelta) {
        bestDelta = delta;
        best = s;
      }
    });
    [png.data[i], png.data[i + 1], png.data[i + 2]] = palette[best];
  }
  return { buffer: PNG.sync.write(png), shades };
}

/* ----------------------------------------------------------------------- cli */

function usage() {
  console.log(`Recolour a Game Boy screenshot into a Gambatte palette.

  npm run palette -- --list [filter]
  npm run palette -- <input.png> "<palette name>" [-o <output.png>]

Examples:
  npm run palette -- --list "TWB64 04"
  npm run palette -- public/samples/gb-tetris.png "TWB64 040 - DMG Ver."
`);
}

async function main() {
  const args = process.argv.slice(2);
  const palettes = loadPalettes();

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    usage();
    return;
  }

  if (args[0] === '--list') {
    const filter = (args[1] ?? '').toLowerCase();
    const matches = [...palettes].filter(([name]) => name.toLowerCase().includes(filter));
    for (const [name, colours] of matches) console.log(`${name.padEnd(42)} ${colours.map(hex).join(' ')}`);
    console.log(`\n${matches.length} of ${palettes.size} palettes`);
    return;
  }

  const outIndex = args.findIndex((a) => a === '-o' || a === '--out');
  const output = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const positional = args.filter(
    (_, i) => outIndex < 0 || (i !== outIndex && i !== outIndex + 1)
  );
  const [input, name] = positional;

  if (!input || !name) {
    usage();
    process.exitCode = 1;
    return;
  }

  const palette = palettes.get(name);
  if (!palette) {
    console.error(`Unknown palette: "${name}"`);
    console.error('Try: npm run palette -- --list');
    process.exitCode = 1;
    return;
  }

  const buffer = readFileSync(input);
  const chunks = readChunks(buffer);
  const colourType = chunks.find((c) => c.type === 'IHDR').data[9];
  const target = output ?? input;

  if (colourType === 3) {
    const { chunks: recoloured, shades } = recolourIndexed(chunks, palette);
    writeFileSync(target, writeChunks(recoloured));
    console.log(`${input} → ${target}   (indexed, PLTE rewrite)`);
    console.log(`  ${shades.map(hex).join(' ')}  →  ${palette.map(hex).join(' ')}`);
  } else {
    const { buffer: recoloured, shades } = await recolourTruecolour(buffer, palette);
    writeFileSync(target, recoloured);
    console.log(`${input} → ${target}   (truecolour, ${shades.length} shades matched)`);
    console.log(`  ${shades.map(hex).join(' ')}  →  ${palette.map(hex).join(' ')}`);
  }
  console.log(`  palette: ${name}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
