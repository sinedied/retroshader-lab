/**
 * Game Boy palette recolouring, in the browser.
 *
 * The bundled Game Boy screenshots have a greyscale master in `public/samples/originals/`,
 * captured in the flat four shades the DMG outputs. Any of Gambatte's palettes can therefore
 * be applied by swapping those four shades for the palette's four colours — the same thing
 * `npm run palette` does offline, done per frame-source instead.
 *
 * The table itself is written by `npm run shaders` into `public/palettes/gb-palettes.json`
 * and fetched lazily: it is ~50KB, and nobody who never opens a Game Boy screenshot should
 * pay for it.
 */
import type { SourceImage } from './types.js';

export interface GbPalette {
  name: string;
  /** Four `#rrggbb` colours, lightest first, as Gambatte orders them. */
  colours: string[];
}

export interface GbPaletteGroup {
  group: string;
  palettes: GbPalette[];
}

/** The palette the bundled screenshots were already recoloured to, so the look is unchanged. */
export const DEFAULT_GB_PALETTE = 'TWB64 040 - DMG Ver.';

/**
 * The four shades a DMG capture uses, lightest first.
 *
 * Pixels are matched to the nearest of these by luminance rather than by equality: the
 * browser may apply a colour profile while decoding and shift a channel by a point or two,
 * which would leave an exact match silently unrecoloured.
 */
const DMG_SHADES = [248, 168, 96, 0];

let cache: Promise<GbPaletteGroup[]> | undefined;

/** The palette table, fetched once. */
export async function loadGbPalettes(): Promise<GbPaletteGroup[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}palettes/gb-palettes.json`).then((response) => {
    if (!response.ok) throw new Error(`Failed to load the palette table: ${response.status}`);
    return response.json() as Promise<GbPaletteGroup[]>;
  });
  try {
    return await cache;
  } catch (error) {
    // a failed fetch must not poison every later attempt
    cache = undefined;
    throw error;
  }
}

export function findGbPalette(groups: GbPaletteGroup[], name: string): GbPalette | undefined {
  for (const group of groups) {
    const found = group.palettes.find((palette) => palette.name === name);
    if (found) return found;
  }
  return undefined;
}

/** The group a palette belongs to, for putting the two dropdowns back in step. */
export function groupOfGbPalette(groups: GbPaletteGroup[], name: string): string | undefined {
  return groups.find((group) => group.palettes.some((p) => p.name === name))?.group;
}

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Repaints a greyscale Game Boy capture into `palette`.
 *
 * Returns a canvas, which `SourceImage.bitmap` accepts and WebGL uploads directly, so no
 * copy back through an `Image` is needed.
 */
export function recolourGbImage(
  image: CanvasImageSource,
  width: number,
  height: number,
  palette: GbPalette
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently: this reads the whole buffer straight back, which is the case the
  // hint exists for; without it Chrome keeps the canvas GPU-side and the read stalls.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D context to recolour the screenshot');

  ctx.drawImage(image, 0, 0, width, height);
  const frame = ctx.getImageData(0, 0, width, height);
  const pixels = frame.data;
  const rgb = palette.colours.map(parseHex);

  for (let i = 0; i < pixels.length; i += 4) {
    // the master is grey, so any channel carries the shade; green is the least likely to
    // have been touched by a profile conversion
    const shade = pixels[i + 1];
    let best = 0;
    let bestDelta = Math.abs(shade - DMG_SHADES[0]);
    for (let s = 1; s < DMG_SHADES.length; s++) {
      const delta = Math.abs(shade - DMG_SHADES[s]);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = s;
      }
    }
    const [r, g, b] = rgb[best] ?? rgb[rgb.length - 1];
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }

  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/**
 * A recoloured `SourceImage`.
 *
 * The palette name is part of the id on purpose: the pipeline caches its source texture on
 * that id, so leaving it out would upload the first palette and then quietly ignore every
 * later one.
 */
export function recolouredSource(
  base: SourceImage,
  image: CanvasImageSource,
  palette: GbPalette
): SourceImage {
  return {
    ...base,
    id: `${base.id}:palette=${palette.name}`,
    bitmap: recolourGbImage(image, base.width, base.height, palette)
  };
}
