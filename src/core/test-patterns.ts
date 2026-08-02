/**
 * Procedural test patterns at the resolutions emulated systems actually output, so
 * shader behaviour (scanline phase, dot matrix alignment, sharpening, moiré) can be
 * judged without needing a real screenshot. Real screenshots can be dropped in or
 * placed in `public/samples/`.
 */
import type { SourceImage } from './types.js';

export interface SystemResolution {
  id: string;
  label: string;
  width: number;
  height: number;
  /**
   * Display aspect ratio the libretro core reports, which is not the pixel ratio for
   * the systems that stretch to 4:3.
   */
  aspect: number;
}

export const SYSTEM_RESOLUTIONS: SystemResolution[] = [
  // square-pixel handhelds report their native ratio
  { id: 'gb', label: 'Game Boy', width: 160, height: 144, aspect: 10 / 9 },
  { id: 'gbc', label: 'Game Boy Color', width: 160, height: 144, aspect: 10 / 9 },
  { id: 'gba', label: 'Game Boy Advance', width: 240, height: 160, aspect: 3 / 2 },
  { id: 'p8', label: 'PICO-8', width: 128, height: 128, aspect: 1 },
  // consoles stretch non-square pixels to 4:3 on a TV
  { id: 'nes', label: 'NES / Famicom', width: 256, height: 240, aspect: 4 / 3 },
  { id: 'snes', label: 'SNES / Super Famicom', width: 256, height: 224, aspect: 4 / 3 },
  { id: 'md', label: 'Mega Drive / Genesis', width: 320, height: 224, aspect: 4 / 3 },
  { id: 'ps1', label: 'PlayStation', width: 320, height: 240, aspect: 4 / 3 },
  { id: 'psp', label: 'PSP', width: 480, height: 272, aspect: 480 / 272 }
];

/** Display aspect of a system, falling back to 4:3 for anything unknown. */
export function aspectOfSystem(id: string): number {
  return SYSTEM_RESOLUTIONS.find((system) => system.id === id)?.aspect ?? 4 / 3;
}

export type PatternKind = 'grid' | 'colorbars' | 'gradient' | 'white' | 'scroll';

export const PATTERN_KINDS: { id: PatternKind; label: string }[] = [
  { id: 'grid', label: '1px grid & checkerboard' },
  { id: 'colorbars', label: 'Color bars & ramps' },
  { id: 'gradient', label: 'Dithered gradients' },
  { id: 'white', label: 'Pure white' },
  { id: 'scroll', label: 'Scrolling field (motion)' }
];

/**
 * Side of the repeating cell in the scrolling pattern.
 *
 * It has to divide the source resolution on both axes or the wrap shows a seam, and 16 is
 * the largest value that does so for every system here — 32 already fails on the Game Boy,
 * GBA, NES, PlayStation and PSP. Each cell holds four 8×8 blocks.
 */
const SCROLL_CELL = 16;

function fillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  fillRect(ctx, 0, 0, w, h, '#000000');
  // 1px checkerboard: shows any non pixel-perfect scaling instantly.
  const half = Math.floor(h / 2);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < w; x++) {
      if ((x + y) % 2 === 0) fillRect(ctx, x, y, 1, 1, '#ffffff');
    }
  }
  // Alternating 1px horizontal then vertical lines.
  for (let y = half; y < h; y += 2) fillRect(ctx, 0, y, Math.floor(w / 2), 1, '#ffffff');
  for (let x = Math.floor(w / 2); x < w; x += 2) fillRect(ctx, x, half, 1, h - half, '#ffffff');
  // Reference border, 1px.
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function drawColorBars(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
  const barW = w / bars.length;
  for (const [i, color] of bars.entries()) {
    fillRect(ctx, Math.floor(i * barW), 0, Math.ceil(barW), Math.floor(h * 0.6), color);
  }
  for (let x = 0; x < w; x++) {
    const v = Math.round((x / (w - 1)) * 255);
    fillRect(ctx, x, Math.floor(h * 0.6), 1, Math.floor(h * 0.2), `rgb(${v},${v},${v})`);
  }
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    fillRect(
      ctx,
      Math.floor((i * w) / steps),
      Math.floor(h * 0.8),
      Math.ceil(w / steps),
      h,
      `rgb(${v},${v},${v})`
    );
  }
}

function drawGradient(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const band = Math.floor((y / h) * 3);
      const threshold = bayer[y % 4][x % 4] / 16;
      const quantized = Math.floor(t * 8 + threshold) / 8;
      const value = Math.round(Math.min(1, quantized) * 255);
      const i = (y * w + x) * 4;
      image.data[i] = band === 0 || band === 2 ? value : 0;
      image.data[i + 1] = band === 1 || band === 2 ? value : 0;
      image.data[i + 2] = band === 2 ? value : band === 0 ? 0 : value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * A field that stays legible while it moves, for hunting moiré that only appears in motion.
 *
 * Strictly periodic with a `SCROLL_CELL` period on both axes, so scrolling it wraps without
 * a seam — a seam would drag a hard edge through the frame and manufacture exactly the kind
 * of artifact this is meant to expose. Each cell carries four 8×8 blocks at the frequencies
 * that beat against a shader's own grid — a checkerboard, vertical lines, horizontal lines
 * and diagonals — so whichever one is moiréing can be told apart from the others.
 */
function drawScroll(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const half = SCROLL_CELL / 2;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x % SCROLL_CELL;
      const cy = y % SCROLL_CELL;
      // which of the four blocks in the cell, and the 1px pattern it carries
      let on: boolean;
      if (cy < half) on = cx < half ? (x + y) % 2 === 0 : x % 2 === 0;
      else on = cx < half ? y % 2 === 0 : (x + y) % 4 < 2;
      const value = on ? 255 : 0;
      const i = (y * w + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Renders a pattern into a canvas of the exact system resolution. */
export function createTestPattern(
  width: number,
  height: number,
  kind: PatternKind
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;

  switch (kind) {
    case 'colorbars':
      drawColorBars(ctx, width, height);
      break;
    case 'gradient':
      drawGradient(ctx, width, height);
      break;
    case 'white':
      // a flat full-white field: the shader's own pattern is all that is left, which is
      // what makes a mask, a grid or a scanline measurable on its own
      fillRect(ctx, 0, 0, width, height, '#ffffff');
      break;
    case 'scroll':
      drawScroll(ctx, width, height);
      break;
    default:
      drawGrid(ctx, width, height);
      break;
  }
  return canvas;
}

export function makeGeneratedSource(system: SystemResolution, kind: PatternKind): SourceImage {
  return {
    id: `${system.id}:${kind}`,
    label: `${system.label} — ${system.width}×${system.height}`,
    width: system.width,
    height: system.height,
    bitmap: createTestPattern(system.width, system.height, kind),
    // the scrolling field is built from a repeating cell, so at a resolution the cell divides
    // it wraps straight round; mirroring it would flip the checkerboard phase at the fold
    tileable: kind === 'scroll' && tilesSeamlessly(system.width, system.height)
  };
}

/** Whether a pattern wraps without a seam at this resolution. */
export function tilesSeamlessly(width: number, height: number): boolean {
  return width % SCROLL_CELL === 0 && height % SCROLL_CELL === 0;
}

/**
 * The mirrored tile a non-tileable source scrolls through, kept for one source at a time.
 *
 * Only ever one source is in motion, and a palette change makes a new id, so a single entry
 * both hits every frame and cannot grow without bound.
 */
let mirrorTile: { key: string; canvas: HTMLCanvasElement } | undefined;

/** Draws `img`, optionally mirrored on either axis, from a source rect to a destination point. */
function drawPart(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  flipX: boolean,
  flipY: boolean
): void {
  if (sw <= 0 || sh <= 0) return;
  ctx.save();
  ctx.translate(flipX ? dx + sw : dx, flipY ? dy + sh : dy);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
}

/**
 * Builds the reflected tile a screenshot scrolls through.
 *
 * The reflection is *whole-sample*: the period is `2w-2`, not `2w`, so the edge column is not
 * repeated. Reflecting about the pixel (`… w-2, w-1, w-2 …`) is continuous, while reflecting
 * about the gap (`… w-2, w-1, w-1, w-2 …`) leaves a two-pixel constant band running down the
 * frame — exactly the sort of small artifact this lab exists to find, manufactured by the
 * test rig itself.
 */
function buildMirrorTile(base: SourceImage): HTMLCanvasElement {
  if (mirrorTile?.key === base.id) return mirrorTile.canvas;
  const { width: w, height: h } = base;
  const canvas = document.createElement('canvas');
  canvas.width = mirrorPeriod(w);
  canvas.height = mirrorPeriod(h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;
  drawPart(ctx, base.bitmap, 0, 0, w, h, 0, 0, false, false);
  drawPart(ctx, base.bitmap, 1, 0, w - 2, h, w, 0, true, false);
  drawPart(ctx, base.bitmap, 0, 1, w, h - 2, 0, h, false, true);
  drawPart(ctx, base.bitmap, 1, 1, w - 2, h - 2, w, h, true, true);
  mirrorTile = { key: base.id, canvas };
  return canvas;
}

/** Period of a whole-sample reflection, which needs at least two pixels to reflect about. */
function mirrorPeriod(size: number): number {
  return size > 1 ? size * 2 - 2 : size;
}

/**
 * `base` shifted by `(offsetX, offsetY)` source pixels, wrapping at the edges.
 *
 * Built the way a core builds a frame: the whole framebuffer moves by a whole number of
 * pixels and what leaves one edge arrives at the other. That is four `drawImage` calls of a
 * cached tile rather than a per-pixel redraw, which at 60fps would be far too slow for a
 * 480×272 frame.
 *
 * A screenshot's left edge does not match its right, so wrapping one directly would drag a
 * hard seam across the frame — a false artifact that shaders ring on and that reads as the
 * very thing this is meant to expose. Those are scrolled through a mirrored tile instead,
 * which has no seam at all. A source that already tiles wraps straight round.
 *
 * The offset is part of `id` because the pipeline caches its source texture on that id — a
 * fixed id would upload the first frame and then quietly never update again. When a slow
 * speed leaves the offset unchanged between frames the id repeats, and skipping that upload
 * is exactly right: nothing moved.
 */
export function makeScrolledSource(
  base: SourceImage,
  offsetX: number,
  offsetY: number
): SourceImage {
  const { width: w, height: h } = base;
  const tile = base.tileable ? base.bitmap : buildMirrorTile(base);
  const periodX = base.tileable ? w : mirrorPeriod(w);
  const periodY = base.tileable ? h : mirrorPeriod(h);

  // positive offsets move the image right and down, and wrap within one period
  const ox = ((offsetX % periodX) + periodX) % periodX;
  const oy = ((offsetY % periodY) + periodY) % periodY;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;
  // the shifted tile plus whatever wraps back in on each axis; a period is at least as wide
  // as the frame, so two copies per axis always cover it
  for (const dx of [ox - periodX, ox]) for (const dy of [oy - periodY, oy]) {
    ctx.drawImage(tile, dx, dy);
  }

  return {
    id: `${base.id}:scroll:${ox},${oy}`,
    label: base.label,
    width: w,
    height: h,
    bitmap: canvas
  };
}

/** Loads a user-provided screenshot (drag & drop, file picker or `public/samples`). */
export async function loadImageSource(file: File | string, label?: string): Promise<SourceImage> {
  const url = typeof file === 'string' ? file : URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const name = label ?? (typeof file === 'string' ? file.split('/').pop() : file.name) ?? 'image';
    return {
      id: `file:${name}:${image.naturalWidth}x${image.naturalHeight}`,
      label: `${name} — ${image.naturalWidth}×${image.naturalHeight}`,
      width: image.naturalWidth,
      height: image.naturalHeight,
      bitmap: image
    };
  } finally {
    if (typeof file !== 'string') setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
